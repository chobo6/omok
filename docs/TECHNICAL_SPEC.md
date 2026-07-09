# 기술 설계서 — 온라인 오목

> **버전**: 1.1  
> **작성일**: 2026-07-02

---

## 1. 시스템 아키텍처

```
브라우저 (React)
    │
    │  HTTP + WebSocket (Socket.io)
    │  Vite proxy: /socket.io → localhost:4000
    ▼
Express 서버 (Node.js)
    │
    ├── 게임 상태 (in-memory Map)
    └── Socket.io 이벤트 핸들러
```

### 선택 이유

| 기술 | 대안 | 선택 이유 |
|---|---|---|
| Vite + React | Next.js, CRA | 빠른 빌드, HMR. SSR 불필요 |
| Socket.io | 네이티브 WebSocket | 자동 재연결, 방(Room) 추상화 내장 |
| In-memory 상태 | Redis, DB | MVP 단계 — 배포 없이 바로 실행 가능 |
| Canvas | SVG, DOM | 보드 크기에 따른 성능, 자유로운 드로잉 |

---

## 2. 디렉토리 구조

```
omok/
├── server/
│   ├── index.js          # Express + Socket.io 서버 진입점, REST(/api/rooms, /api/leaderboard)
│   ├── gameLogic.js      # 순수 게임 로직 (보드 생성, 5목 판정)
│   ├── forbidden.js      # 렌주룰 금수 판정 (CJS)
│   ├── ratings.js        # ELO 레이팅 계산/저장
│   └── data/
│       └── ratings.json  # ELO 레이팅 영구 저장 파일 (런타임 생성, gitignore 처리)
│
├── client/
│   ├── vite.config.js    # Vite 설정 + /socket.io, /api 프록시
│   └── src/
│       ├── App.jsx        # 페이지 라우팅 (lobby ↔ game ↔ leaderboard)
│       ├── pages/
│       │   ├── Lobby.jsx       # 공개방/랭킹전 2탭 + AI 대전 선택
│       │   ├── Game.jsx        # 게임 화면 (보드, 채팅, 타이머, 레이팅 통합)
│       │   └── Leaderboard.jsx # 랭킹 순위표
│       ├── components/
│       │   ├── Board.jsx      # Canvas 오목판 렌더링, 금수 삼각형 표시, 승리 5목 라인 하이라이트
│       │   ├── Chat.jsx       # 채팅 UI
│       │   └── PlayerInfo.jsx # 플레이어 정보 + 타이머 + 레이팅 배지 + 게임 종료 승/패/무 결과 배지
│       └── utils/
│           ├── aiEngine.js    # Minimax + VCF 위협 탐색 AI (클라이언트 사이드)
│           ├── aiWorker.js    # aiEngine을 Web Worker에서 실행
│           ├── forbidden.js   # 렌주룰 금수 판정 (ESM)
│           └── userId.js      # localStorage 기반 익명 UUID 발급
│
└── docs/
    ├── PRD.md
    ├── TECHNICAL_SPEC.md
    └── TROUBLESHOOTING.md
```

---

## 3. 게임 상태 자료구조

### 서버 — Room 객체

```js
{
  board: number[][],        // 15×15 배열. 0=빈칸, 1=흑, 2=백
  players: string[],        // [socketId_흑, socketId_백]
  nicknames: { [socketId]: string },
  currentTurn: 1 | 2,
  status: 'waiting' | 'playing' | 'ended' | 'ranked_pending',
  lastMove: { row, col, player } | null,
  chat: { nickname, message, time }[],
  timers: { [socketId]: number },   // 남은 시간(초)
  timerInterval: NodeJS.Timeout,
  rematchVotes: Set<string>,        // 재경기 동의 socketId
  type: 'public' | 'ranked',
  userIds: { [socketId]: string },        // 레이팅 조회용 익명 UUID
  initialRatings: { [socketId]: number | null }, // 입장 시점 레이팅 스냅샷 (표시용)
  pendingUsers?: { userId, nickname, rating }[], // status: 'ranked_pending'일 때만 — 매칭됐지만 아직 소켓 미입장
}
```

### 서버 — 랭킹전 매칭 대기열

```js
rankedQueue: { socketId, userId, nickname, rating }[]
```

`ranked:queue:join` 시 대기열에 상대가 있으면 즉시 pop해 `ranked_pending` 방을 만들고, 없으면 자신을 대기열에 push. 30초 내 양쪽 모두 `ranked:join`으로 입장하지 않으면 방이 자동 삭제됨.

### 승리 판정 알고리즘

4방향(가로/세로/대각선 ↘↙)으로 뻗어나가며 연속 5개를 카운트.

```
directions = [(0,1), (1,0), (1,1), (1,-1)]

for each direction (dr, dc):
    count = 1
    extend forward  (max 4칸)
    extend backward (max 4칸)
    if count >= 5 → win
```

---

## 4. Socket.io 이벤트 명세

### 클라이언트 접속 시 인증 — 세션 쿠키

클라이언트는 Google Identity Services로 로그인하고, 서버(`POST /api/auth/google`)가 ID 토큰을 검증한 뒤 세션 JWT를 발급해 httpOnly + `sameSite: 'lax'` 쿠키(`omok_session`)로 내려준다(`GET /api/auth/me`로 세션 복원, `POST /api/auth/logout`으로 폐기). 소켓 연결 시에는 `io('/', { withCredentials: true })`로 브라우저가 이 쿠키를 자동으로 함께 전송하며, 서버는 `io.use()` 미들웨어에서 핸드셰이크 쿠키 헤더를 파싱·검증해 `socket.data.userId`에 저장한다. 검증 실패/쿠키 없음이면 `socket.data.userId`는 `null`이며, 이 경우 게스트로 취급되어 랭킹전 관련 기능(레이팅 조회/갱신 등)은 비활성화되지만 공개방·AI 대전은 그대로 이용할 수 있다.

이 쿠키 기반 방식은 클라이언트와 서버가 사실상 동일 사이트로 취급되어야 동작한다 — 개발 환경에서는 Vite 프록시가 브라우저 입장에서 동일 출처처럼 보이게 해주지만, 배포 환경에서 클라이언트와 API가 서로 다른 출처로 나뉘면 `sameSite: 'lax'` 쿠키가 전송되지 않으므로 `sameSite: 'none'` + `secure: true` 조합으로 전환해야 한다.

### 클라이언트 → 서버 (emit)

| 이벤트 | payload | 설명 |
|---|---|---|
| `room:create` | `{ nickname, type: 'public' }` | 새 방 생성 |
| `room:join` | `{ roomId, nickname }` | 방 입장 (공개방 목록에서) |
| `room:spectate` | `{ roomId }` | 관전 입장 — `room.players`에 추가되지 않음(착수/채팅 불가), 입장 즉시 현재 `room:state` 스냅샷을 받고 이후 브로드캐스트도 계속 수신 |
| `ranked:queue:join` | `{ nickname }` | 랭킹전 매칭 대기열 등록 (대기 상대 있으면 즉시 매칭) |
| `ranked:queue:leave` | — | 매칭 대기열 취소 |
| `ranked:join` | `{ roomId }` | 매칭된 랭킹전 방에 실제 소켓 입장 |
| `profile:get` | — | 내 레이팅/전적 조회 |
| `game:move` | `{ row, col }` | 착수 |
| `game:surrender` | — | 항복 |
| `game:rematch` | — | 재경기 요청 |
| `chat:send` | `{ message }` | 채팅 전송 |

### 서버 → 클라이언트 (emit)

| 이벤트 | payload | 설명 |
|---|---|---|
| `room:created` | `{ roomId }` | 방 생성 완료, 코드 전달 |
| `room:joined` | `{ roomId }` | 방 입장 성공 |
| `room:error` | `{ message }` | 입장/매칭 실패 사유 |
| `room:state` | RoomState | 보드/턴/타이머/레이팅 전체 상태 동기화 |
| `timer:tick` | `{ socketId, timeLeft }` | 매초 타이머 갱신 |
| `game:over` | `{ winner, winnerId, reason, winLine? }` | 게임 종료. `reason: 'win'`이면 승리로 이어진 연속 돌 좌표 배열 `winLine: [{row,col}, ...]`(길이 5 이상, 백은 장목 승리 시 6개 이상 가능)을 함께 보냄 — `Board.jsx`가 이 좌표들을 금색으로 하이라이트. 랭킹전이면 서버가 내부적으로 ELO 갱신 후 `rating:update`도 emit |
| `game:rematch_requested` | `{ by }` | 상대방 재경기 요청 알림 |
| `game:restarted` | — | 재경기 시작 |
| `chat:message` | `{ nickname, message, time }` | 채팅 수신 |
| `ranked:queue:status` | `{ position }` | 대기열 등록 완료, 대기 순번 |
| `ranked:match:found` | `{ roomId }` | 매칭 성사, `ranked:join`으로 입장 필요 |
| `rating:update` | `{ delta, newRating }` | 랭킹전 종료 후 레이팅 변화량/신규 레이팅 |
| `profile:data` | `{ rating, wins, losses, draws, nickname }` | `profile:get` 응답 |

### REST API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/rooms` | `status`가 `'waiting'` 또는 `'playing'`인 공개방(`type: 'public'`) 목록(`'ended'`는 제외) — 진행 중인 방도 남겨둬 관전 입장 가능. 클라이언트가 로비에서 폴링 |
| `GET /api/leaderboard` | 전적 있는 유저 중 레이팅 상위 20명 (`server/ratings.js`의 `getLeaderboard`) |

#### `room:state` payload 구조

```ts
{
  board: number[][],
  players: {
    id: string,
    color: 'black' | 'white',
    nickname: string,
    timeLeft: number,
    rating: number | null,   // 입장 시점 레이팅 스냅샷 (랭킹전 아니면 null)
  }[],
  currentTurn: 1 | 2,
  status: 'waiting' | 'playing' | 'ended',
  lastMove: { row, col, player } | null,
  roomType: 'public' | 'ranked',
}
```

#### `game:over` reason 값

| reason | 설명 |
|---|---|
| `win` | 5목 달성 (`winLine` 포함) |
| `draw` | 보드 전체 채움 |
| `timeout` | 타이머 0초 |
| `surrender` | 항복 |
| `disconnect` | 상대방 연결 끊김 |
| `forbidden` | 흑의 금수(33/44/장목) 착수 — `forbiddenType`, `forbiddenMove` 함께 전달 |

#### 게임 종료 UI (2026-07-09)

게임 종료를 화면을 가리는 모달 대신 **상단 `PlayerInfo` 카드**에 인라인으로 표시한다 — 보드를 가리지 않아 승리 5목 라인을 바로 확인할 수 있고, 관전자 입장에서도 카드별로 승/패가 구분돼 별도 "누가 이겼는지" 텍스트 분기가 필요 없다.

- `Game.jsx`의 `getResult(playerNum)`이 `gameOver`를 기준으로 각 플레이어 카드에 표시할 `{ text: '승리'|'패배'|'무승부', variant: 'win'|'lose'|'draw', reason? }`를 계산 — `reason`은 `win` 외의 사유일 때만 짧게 덧붙임(예: `승리 · 시간초과`, `패배 · 금수 33`)
- `PlayerInfo.jsx`는 게임 중엔 "내 차례" 뱃지를, 종료 후엔 이 `result` 뱃지를 같은 자리에 표시. 랭킹전 레이팅 변화(`ratingDelta`)도 "내" 카드의 레이팅 숫자 옆에 인라인으로 붙음(`+15`/`-12`)
- 하단 액션 버튼도 게임 중엔 "항복", 종료 후엔 "재경기 요청"/"다시하기"로 같은 자리에서 바뀜(`status`에 따라 분기, 모달의 별도 버튼 영역 없이 기존 액션 줄 재사용)

---

## 5. AI 엔진

### 위치: `client/src/utils/aiEngine.js` (연산 본체), `client/src/utils/aiWorker.js` (실행 스레드)

`getAIMove` 자체는 클라이언트에서 실행되지만(서버 부하 없음), Web Worker 위에서 돌아가 메인(UI) 스레드를 막지 않는다. `getAIMove(board, aiPlayer)`의 `aiPlayer`는 1(흑) 또는 2(백) 둘 다 가능 — 2026-07-04부터 로비에서 사람이 흑/백을 선택할 수 있게 되면서(`Lobby.jsx`의 `humanColor`) AI가 반대 색을 맡는다. 백은 금수 제한이 없고, **흑을 맡을 땐 AI 스스로 자기 금수(33/44/장목)를 회피**한다(아래 참고).

### 구현된 알고리즘 흐름

```
getAIMove(board, aiPlayer)
    │
    ├─ 0. 오프닝: 보드에 돌이 1개(상대 첫 수)뿐이면 대각선 4방향 중 랜덤 응수
    ├─ 1. 즉시 승리 수 탐색 → 있으면 즉시 반환
    ├─ 2. 오프닝북 조회 → 현재 국면이 openingBook.js의 저장된 국면과 정확히
    │     일치하면 그 수 즉시 반환, 안 맞으면 통과(아래로 계속 진행)
    ├─ 3. VCF(연속사 강제 승리) 탐색 → 강제 승리 수순이 있으면 그 첫 수 반환
    │     ※ 방어보다 먼저 확인한다. VCF가 성립하면 상대는 매 수 내 사(四)를 막느라
    │       자기 위협을 완성할 틈이 없으므로, 상대가 무슨 위협을 걸었든 밀어붙여 이기는 게 최선.
    │       (searchVCF 내부에서 상대 즉시 승리 가능성을 확인하므로, 상대가 먼저 이길 수 있으면
    │        스스로 실패 처리하고 아래 방어로 넘어감). 완성 지점이 1곳뿐이어도 그 자리가
    │       상대(흑)에게 금수(33/44/장목)면 상대가 못 막으므로 확정승리로 처리
    ├─ 4. 위급 방어 자리 계산(상대가 다음 수로 (a) 5목을 완성하거나 (b) 완성 지점이
    │     2곳 이상인 사를 만드는 자리, 단 그 자리가 상대에게 금수면 제외) → 즉시
    │     반환하지 않고 "강제 후보"로만 표시
    ├─ 5. 후보 수 생성 (기존 돌 주변 2칸 이내 빈 칸, 중복 제거) — **AI가 흑(`aiPlayer===1`)이면
    │     여기서 자기 금수(33/44/장목) 자리를 후보에서 제외**. 즉시승리·위급방어·최종
    │     탐색이 전부 이 필터링된 목록만 보므로, 루트에서 반환하는 수가 절대 금수일 수
    │     없다(negamax 재귀 내부까지는 필터링 안 함 — 매 노드 금수 판정은 성능 비용이 큼)
    └─ 6. 반복심화(Iterative Deepening) + Transposition Table 탐색 (시간 예산 2초)
          → 4의 강제 후보는 MAX_CANDIDATES_PER_NODE에 밀려 잘리지 않도록 최우선 순위 고정,
            실제 선택은 탐색이 몇 수 앞을 보고 결정. 시간이 끝난 시점까지 완료된 depth 중
            가장 깊은 결과를 채택
```

> 4단계는 2026-07-04 이전엔 "즉시 반환"이었다(위급 방어 자리를 찾으면 탐색 없이 바로 그 수를 둠). 실전 패배 국면을 추적해보니 강한 상대(Yixin)와 대국할 때 백이 둔 수의 최대 70%가 이 반사 분기였다는 게 드러나 — 이러면 AI가 한 수 앞도 못 내다보고 방어만 반복하게 된다. `orderCandidates`/`rootSearch`/`iterativeDeepeningSearch`에 `forcedCells` 파라미터를 추가해, 위급 방어 자리는 "반드시 고려할 후보"로만 강제하고 실제 선택은 탐색이 하도록 변경했다.

> 5단계의 흑 금수 회피는 2026-07-04에 추가됐다(로비에서 사람이 흑/백을 선택할 수 있게 되면서 AI가 흑을 맡을 가능성이 생김). `searchVCF`가 반환하는 수도 `findFourMoves` 내부에서 별도로 `getCandidates`를 호출해 위 필터를 안 거치므로, 3단계 반환 직전에 한 번 더 금수 여부를 확인한다. `Game.jsx`에도 AI 착수 직후 같은 확인을 한 번 더 두어(이중 안전망), 혹시 회피에 실패해도 사람이 금수를 뒀을 때와 동일하게 즉시 패배 처리한다.

### 탐색 엔진 (`negamax` + `rootSearch` + `iterativeDeepeningSearch`)

기존 고정 depth-3 Minimax를 Rapfi([dhbloo/rapfi](https://github.com/dhbloo/rapfi)) 등 실제 강한 오목 엔진의 구조를 참고해 다음으로 교체:

- **Negamax + Alpha-Beta**: 기존에 최대화/최소화 분기를 따로 두던 `minimax`를, 매 노드에서 "지금 둘 차례인 쪽" 관점으로 부호를 뒤집는 `negamax` 하나로 통일 (표준 엔진 구조와 동일)
- **반복심화(Iterative Deepening)**: 고정 depth-3 대신 `TIME_BUDGET_MS`(기본 2000ms) 안에서 depth 1→2→3…로 점점 깊이 탐색. 시간이 끝난 depth의 부분 결과는 버리고 마지막으로 완료된 depth의 결과만 채택 — 국면 복잡도에 따라 자동으로 깊이가 달라짐 (실측: 초반 국면 depth 5, 중반 혼잡한 국면 depth 7까지 도달, 기존 고정 depth-3 대비 2배 이상)
- **Transposition Table (Zobrist 해싱)**: `ZOBRIST[row][col][player]` 난수표로 보드 해시를 증분 계산(`XOR`)하고, 이번 `getAIMove` 호출 동안만 유지되는 `Map` 기반 캐시에 `{depth, value, bound, bestMove}` 저장. 동일/유사 국면 재탐색을 줄이고, depth가 깊어질 때 이전 depth에서 찾은 최선 수를 다음 depth의 탐색 순서 맨 앞에 배치해 알파베타 가지치기 효율을 높임
- **매 노드 후보 재정렬**: 기존엔 루트에서 한 번만 후보를 정렬하고 재귀 내부(`minimax`)는 정렬 없이 그대로 썼는데, `orderCandidates`로 모든 노드에서 매번 `scoreCell` 기준 재정렬 + 상위 `MAX_CANDIDATES_PER_NODE`(20)개로 제한하도록 수정

이번 업그레이드는 Rapfi/Piskvork 리서치 결과 중 JS(브라우저)로 이식 가능한 구조적 기법만 반영한 것 — Rapfi의 NNUE 신경망 평가·MCTS·멀티스레드 탐색 등은 학습된 가중치·네이티브 런타임이 필요해 제외 (자세한 리서치 내용은 `docs/todo.md` 참고).

- **오프닝 다양화(`getOpeningMove`)**: 오목의 관례상 흑의 첫 수는 항상 정중앙이라, AI의 첫 응수가 매번 똑같으면 패턴이 뻔해짐. 상대 돌이 1개뿐인 국면에서는 그 돌 기준 대각선 4방향(간접 오프닝, RIF 분류상 직교보다 백에게 전반적으로 균형적) 중 무작위로 응수해 개국을 다양화
- **오프닝북(`openingBook.js`)**: `getOpeningMove`가 실제로 고를 수 있는 8방향(상하좌우+대각선) 전부 각각에 대해, 로컬 Yixin에게 pbrain `BOARD` 명령으로 직접 질의해 얻은 백의 4/6수째 응수 16개를 저장. 국면을 "row,col,player" 정렬 문자열로 키를 만들어 정확히 일치할 때만 사용, 안 맞으면 정상 탐색으로 폴백. (`getOpeningMove` 자체를 대각선만으로 제한하는 방안도 검토했으나 그 변경 자체가 이전에 무효로 판정돼 되돌려진 상태라, 8방향 전부를 커버하는 쪽으로 북을 맞춤). 2026-07-05에 RIF(렌주 국제연맹) 공인 26개 정석 분류 중 흑에게 가장 유리한(★★★) 8개 라인을 골라 `tools/query-yixin-line.mjs`로 Yixin에게 5수씩 더 이어붙인 뒤, 렌주 규칙의 회전 대칭을 이용해 8방향 전부로 확장하고 흑 차례(3/5/7수째) 항목까지 함께 뽑아(`tools/generate_book_symmetry.mjs`) 총 168개 항목으로 확장. `aiEngine.js`의 북 조회도 `aiPlayer===2` 전용에서 색 무관 조회로 일반화(흑 항목은 반환 전 `checkForbidden` 재확인). 이후 사용자 요청으로 우월(D6)·운월(I6)·은월(I9) 3개 라인을 같은 방식으로 추가해 총 228개 항목(화월=D4·포월=I7은 기존 8개에 이미 포함). `docs/todo.md` "RIF 정석 기반 오프닝북 확장" 절 참고
- **Threat Search(`searchVCF`/`findFourMoves`/`getFourThreats`)**: VCF(Victory by Continuous Fours) 탐색. 사(四)를 만드는 수만 후보로 좁혀, 완성 지점이 2곳 이상(더블사·열린사)이면 즉시 승리 확정, 1곳뿐이면 상대가 그 자리를 막는다고 가정하고 재귀적으로 다음 사를 탐색. depth-3 Minimax가 놓치는 종반 강제 승리 수순을 찾아냄. **VCF-defend(`hasImmediateWin`)**: 매 단계 상대에게 이미 즉시 승리 수가 없는지 확인 — 우리가 강제한 방어 돌들이 누적되며 상대에게 뜻하지 않은 오픈사 등 즉시 승리 기회가 생겼다면 그 수순은 무효로 처리 (완전한 재귀적 카운터 탐색은 아님, 위 "알려진 한계" 참고). **금수 활용(2026-07-04)**: 완성 지점이 1곳뿐이라도 상대(흑)에게 그 자리가 금수(33/44/장목)면 상대는 못 막으므로(두면 즉시 패배) 2곳 이상인 경우와 동일하게 확정승리로 처리 — `checkForbidden`(`client/src/utils/forbidden.js`) 호출. `hasImmediateWin`/`findCriticalDefenseCells`도 흑의 금수 자리는 승리·위협 후보에서 제외(흑의 장목을 승리로 오판하던 문제도 함께 해소)
- **후보 생성(`getCandidates`)**: 놓인 돌 기준 반경 2칸 이내 빈 칸만 탐색 대상으로 삼아 탐색 공간을 축소
- **리프 평가 함수(`evaluate`/증분 평가)**: 탐색 말단(leaf)에서 현재 국면을 점수화. 점수 산정 규칙은 보드 위 모든 5칸 윈도우를 상대 돌이 없는 경우에 한해 "내 돌 개수"별 가중치(`WINDOW_WEIGHTS`)로 합산하는 것(`evaluate = 나의 합 − 상대의 합`)으로, 각 윈도우를 정확히 한 번만 세므로 위협이 강해질수록 점수가 매끄럽게 증가한다(단조성 검증됨). 2026-07-04에 **증분(incremental) 계산 방식**으로 교체 — 예전엔 leaf 방문마다 보드 전체(4방향×15×15 윈도우)를 처음부터 재스캔했는데, 이제는 탐색 시작 시 각 칸이 속한 윈도우 목록(`CELL_WINDOWS`)을 한 번만 계산해두고, 착수/취소마다 그 돌이 속한 윈도우들(최대 20개)의 흑/백 카운트와 누적 점수만 갱신(`applyStoneDelta`)한다. **점수 산정 규칙 자체는 100% 동일**(무작위 대국 21,300회로 기존 방식과 완전 일치 검증) — 순수 속도 개선이며 같은 시간 예산에서 약 1.3배 더 많은 노드를 탐색하지만, Yixin 벤치마크에서는 유의미한 차이가 없었다(아래 "성능 개선 방향" 참고 — 속도/깊이가 병목이 아님을 시사).
- **수 정렬용 셀 평가(`scoreCell`/`buildLine`/`analyzeDirection`)**: 리프 평가와 별개로, 빈 칸 후보의 "여기 두면 얼마나 좋은가"를 채점해 move-ordering에 사용. 중심 셀 기준 반경 4칸(9칸) 라인에서 5칸 창을 슬라이딩하며 위협을 판정하고, `XX.XX`/`.XXX.` 같은 끊긴(gap) 패턴도 인식. **포크 보너스**: 서로 다른 두 방향에서 동시에 사/삼 위협이 겹치면 추가 점수(더블사 +80000, 사+삼 복합 +5000)
- **Web Worker 실행(`aiWorker.js`)**: `Game.jsx`가 `postMessage`로 보드 상태를 넘기면 워커 스레드에서 `getAIMove`를 계산해 결과만 돌려줌. 계산 중에도 메인 스레드(렌더링, 채팅 입력 등)는 그대로 응답

### 휴리스틱 점수표 (`scoreCell` 기준)

| 패턴 | 점수 |
|---|---|
| 내 5목 이상 | 100,000 |
| 상대 5목 이상 위협 | 50,000 |
| 내 열린 4목 (열린 끝 ≥1) | 10,000 |
| 상대 열린 4목 (열린 끝 ≥1) | 8,000 |
| 내 양쪽 열린 3목 | 1,000 |
| 상대 양쪽 열린 3목 | 500 |
| 내 한쪽 열린 3목 | 100 |
| 내 양쪽 열린 2목 | 10 |

(비대칭 평가: 상대의 한쪽 열린 3목·2목 이하는 별도 감점 없음)

### 알려진 한계

- **난이도 고정**: PRD에 계획된 "쉬움/보통/어려움" depth 선택 기능 미구현 (`docs/PRD.md` 4절 참고)
- **VCF-defend는 1수 앞만 확인**: `hasImmediateWin`은 상대가 "지금 바로" 이기는 수가 있는지만 확인함. 상대가 여러 수를 거쳐야 이기는 자기 자신의 강제 승리 수순(카운터 VCF)까지는 검증하지 않는 단순화된 방어 확인 (Rapfi의 `vcfdefend`처럼 완전한 재귀 탐색은 아님)
- **리프 평가가 윈도우 가중합 수준**: 5칸 윈도우의 내 돌 개수별 가중합으로 계산 — 열린/막힌 위협이 윈도우 개수 차이로 자연스럽게 구분되긴 하나, Rapfi류 엔진의 12단계 조합 패턴 평가표(`Pattern4`)처럼 위협 유형을 명시적으로 분류하진 않음. **2026-07-04에 이 부분을 두 가지 다른 방식(열림/막힘 명시 분류, 빈칸 잠재값 기반)으로 고도화 시도했으나 Yixin 벤치마크·제대로 표본을 늘린 자가대국 모두에서 개선을 확인하지 못해 되돌림** (아래 "성능 개선 방향" 참고) — 여전히 유효한 개선 후보지만 정확한 가중치를 찾는 게 생각보다 어려움
- **Killer Move / History Heuristic 없음**: 2026-07-03에 시도했으나, 이 엔진은 `scoreCell` 자체가 이미 강한 전술 신호라 타이브레이킹 여지가 적고 노드당 조회 오버헤드가 이득보다 커서 자가대국 순손실(1승 9패) 확인 후 제거 (`docs/TROUBLESHOOTING.md` #8)
- **PVS(Principal Variation Search) 없음**: 2026-07-03에 시도했으나, Transposition Table과 결합 시 널윈도우 재탐색 직후 풀윈도우 재탐색이 방금 저장된 좁은 바운드를 그대로 재사용해 무력화되는 문제로 자가대국 0승 8패 확인 후 제거 (`docs/TROUBLESHOOTING.md` #8)
- **VCT(사·삼 확장 위협 탐색) 없음**: 2026-07-03에 구현·재구현했으나 두 번 모두 Yixin 벤치마크에서 베이스라인과 실질적으로 동일해 되돌림 — 아래 참고

### 성능 개선 방향 및 검증 이력 (2026-07-03~04, Yixin 벤치마크 기반)

`tools/bench-vs-yixin.mjs`(로컬 설치된 Gomocup 상위권 엔진 Yixin과 실제 대국)로 검증한 결과, **VCT·시간예산 2~40배 조절(양방향)·평가함수 재설계(3종)·자동 가중치 튜닝 전부 유의미한 개선을 보이지 못했다.** 특히 Yixin의 사고시간을 2000ms→50ms로 40배 줄여도 결과가 거의 안 바뀐다는 점에서, **이 엔진과 Yixin의 격차는 탐색 속도/깊이가 아니라 평가·전략 지식의 질에서 온다**는 게 반복 확인됨(자세한 실험 로그는 `docs/todo.md` "AI 엔진 강화" 관련 절 참고). 이 때문에 우선순위를 다음과 같이 재조정한다:

1. **리프 평가 재도전 (더 큰 표본)** — 두 번의 시도가 실패했지만, 정확한 가중치를 찾으려면 후보당 20판보다 훨씬 큰 표본이 필요하다는 게 자동 튜닝 실험에서 확인됨(같은 가중치가 12판에선 9승3패, 20판에선 9승11패로 뒤집힘)
2. **네이티브 속도(WASM 컴파일)** — 지금까지 테스트한 배수(2~40배)에서 속도가 승률에 영향을 못 줬지만, WASM은 자릿수가 다른 속도 향상이라 완전히 배제하긴 이름. 다만 기대치는 낮춰야 함
3. **VCF-defend를 재귀적 카운터 탐색으로 확장** — 위 "VCF-defend는 1수 앞만 확인" 한계 해소
4. **난이도별 depth/시간예산 조절 기능 구현** — PRD 4절의 "AI 난이도 선택" 요구사항 반영. 실력과 무관하게 필요한 기능
5. **Killer Move / History Heuristic, PVS, VCT 재도전** — 전부 한 번 이상 시도 후 되돌린 항목. 원인이 해소되지 않는 한 재시도 우선순위 낮음

### 완료된 개선 항목

- ~~AI 대전 흑/백 선택 + AI 자기 금수 회피~~ — 로비(`Lobby.jsx`)에서 사람이 흑/백을 고를 수 있게 추가(`humanColor` config). `Game.jsx` 전반에 하드코딩돼 있던 "사람=흑(1)/AI=백(2)" 가정(턴 판정·금수 체크 대상·화면 표시 등)을 `humanPlayer`/`aiPlayer` 기반으로 일반화. AI가 흑을 맡을 수 있게 되면서 `aiEngine.js`에 자기 금수 회피 로직 신규 추가(아래 참고) — 10판 자가대국(흑vs백)으로 안전망 발동 없이 정상 동작 확인(흑 6승/백 3승/무1, 금수 패배 0건, 2026-07-04)
- ~~렌주 금수(33/44/장목) 활용~~ — `aiEngine.js`가 렌주 금수 로직(`checkForbidden`, `client/src/utils/forbidden.js`)을 전혀 참조하지 않아 (1) 흑의 유일한 방어 자리가 흑에게 금수인 경우를 "막을 수 있다"고 착각하고, (2) 흑이 6목 이상(장목)을 만드는 걸 승리로 오판하는 두 가지 문제가 있었음(둘 다 서버 로직상 흑은 금수를 두면 승패와 무관하게 즉시 패배 — `server/index.js`가 승패 판정보다 금수 판정을 먼저 함). `searchVCF`(사의 유일한 완성지점이 흑 금수면 확정승리로 처리), `hasImmediateWin`/`findCriticalDefenseCells`(흑의 금수 자리를 승리·위협 후보에서 제외)에 `checkForbidden` 호출 추가. 격리 테스트(함정 있음/없음 대조군)로 오탐 없이 정확히 동작하는 것 확인. Yixin 벤치마크는 무변화였지만(이 함정은 특정 조건에서만 드물게 발동해 6판 안에 안 나타난 것으로 추정 — 다른 다섯 번의 시도처럼 "매 국면에 일반 적용되는" 변경이 아님), 존재하지 않던 능력을 추가하는 것이라 다운사이드 없이 채택(2026-07-04)
- ~~위급 방어를 강제 후보로 전환~~ — 예전엔 위급 방어 자리를 찾으면 탐색 없이 즉시 반환해, 강한 상대가 계속 위협을 만들어내는 한(=거의 매 수) AI가 반사적 방어만 반복하는 문제가 있었음(실전 패배 국면 추적으로 확인 — 백이 둔 수의 최대 70%가 이 반사 분기). `forcedCells` 파라미터로 위급 방어 자리를 "최우선 후보"로만 고정하고 실제 선택은 탐색이 하도록 변경. 자가대국은 실행마다 6승6패~8승4패로 편차가 있었고 Yixin 벤치마크(12판)에서는 베이스라인과 실질적으로 동일했지만, 반사적 방어라는 구조적 결함 자체를 없앤 것이라 채택(2026-07-04, Yixin은 격차가 너무 커서 이 정도로는 승패가 안 갈리는 것으로 추정 — 실제 사람 상대에는 더 유효할 가능성)
- ~~증분 평가함수(incremental evaluation)~~ — leaf 노드마다 보드 전체를 재스캔하던 `boardScore`를, 각 칸이 속한 5칸 윈도우 목록을 미리 계산해두고 착수/취소마다 델타만 갱신하는 방식으로 교체. 점수 산정 규칙은 100% 동일(무작위 대국 21,300회로 완전 일치 검증), 같은 시간 예산에서 약 1.3배 더 많은 노드 탐색. Yixin 벤치마크에서는 유의미한 차이 없었지만 다운사이드 없는 순수 성능 개선이라 채택(2026-07-04)
- ~~후보 영역 바운딩박스 증분 관리~~ — `getCandidates`가 매 노드마다 보드 15×15 전체를 스캔하던 것을, 지금까지 놓인 돌의 바운딩박스(+2칸)만 스캔하도록 축소(`computeBBox`/`expandBBox`). 논리적으로 기존과 동일한 후보 집합을 만들어내 안전하며, 자가대국(800ms 예산) 8전 8승으로 실질 강화 확인 (`docs/TROUBLESHOOTING.md` #8)
- ~~VCF를 방어보다 먼저 실행하도록 순서 변경~~ — 기존엔 방어(`findCriticalDefenseCells`)가 VCF보다 먼저라, AI에게 자기만의 강제 승리 수순이 있어도 상대가 위협을 걸면 방어부터 하던 문제. VCF를 앞으로 옮겨, 강제 승리가 있으면 밀어붙이도록 수정 (`docs/TROUBLESHOOTING.md` #7)
- ~~리프 평가함수 중복 계산 제거~~ — "점유 셀마다 `scoreCell` 합산" 방식이 같은 위협을 돌 개수만큼 중복 계산(열린삼 1개를 3000으로 부풀림)했고, 깊은 탐색이 이 노이즈를 증폭시켜 엉뚱한 수를 두게 만들었음. `boardScore`(라인별 5칸 윈도우를 한 번씩만 세는 방식)로 교체 — 위협 강도에 따라 점수가 단조 증가하도록 수정. 자가대국 검증에서 이전 버전 대비 12판 10승 2패 (`docs/TROUBLESHOOTING.md` #7)
- ~~VCF 상대 반격(1수 앞) 미검증 수정~~ — `searchVCF`가 상대에게 사(四) 완성 지점을 강제로 막게 하는 동안, 그 강제 방어 돌들이 누적되며 상대에게 새로운 즉시 승리 기회(오픈사 등)가 생겨도 알아채지 못하고 계속 강제할 수 있다고 착각하던 문제. `hasImmediateWin`으로 매 단계 상대의 즉시 승리 가능성을 확인하도록 수정 — 처음엔 "완성 지점 2곳 이상(오픈사)" 주장 분기에 이 확인이 빠져 있던 것도 검증 과정에서 추가로 발견해 수정 (`docs/TROUBLESHOOTING.md` #6 참고)
- ~~복합 위협(포크) 평가 보너스 추가~~ — `scoreCell`이 방향별 점수를 단순 합산만 하던 것에, 서로 다른 두 방향에서 동시에 사/삼이 겹치는 "포크" 상황에 추가 보너스를 부여하도록 개선 (더블사 +80000, 사+삼 복합 +5000 등)
- ~~고정 depth-3 → 반복심화 + Transposition Table~~ — `negamax`/`rootSearch`/`iterativeDeepeningSearch`로 교체, 시간 예산(2초) 안에서 국면 복잡도에 따라 depth 5~7까지 자동으로 깊이 확보 (Rapfi 리서치 기반 1단계, 위 탐색 엔진 절 참고)
- ~~열린사(오픈 포) 방어 실패 버그 수정~~ — 기존 즉시방어는 "상대가 이기는 자리"를 하나만 찾으면 바로 멈춰서, 열린사처럼 한 수로 못 막는 이중 위협은 절반만 막고 나머지를 방치해 패배로 이어졌음. `findCriticalDefenseCells`가 상대의 승리 자리(및 완성 지점 2곳 이상인 사)를 전부 모으도록 수정 — 열린삼 단계에서 미리 한쪽을 막아 애초에 열린사가 만들어지지 않도록 예방하는 효과도 있음 (`docs/TROUBLESHOOTING.md` #5 참고)
- ~~끊긴 패턴(gap) 평가 보강~~ — `scoreCell`이 `countLine`(연속 카운트) 방식에서 `buildLine`+`analyzeDirection`(5칸 슬라이딩 윈도우) 방식으로 교체되어 `XX.XX`/`.XXX.` 같은 끊긴 삼·사 위협도 인식
- ~~Web Worker로 이전~~ — `aiWorker.js` 추가, `Game.jsx`가 메인 스레드 대신 워커에 계산을 위임. 착수 연산 중에도 페이지가 멈추지 않고 채팅 등 다른 UI 조작이 가능해짐
- ~~VCF(연속사 강제 승리) 탐색 추가~~ — `searchVCF`로 depth-3 Minimax가 못 보는 종반 강제 승리 수순을 찾아냄 (완전한 VCT는 아님, 위 한계 참고)

### 검증 도구: Yixin 대국 벤치마크 (`tools/bench-vs-yixin.mjs`)

자가대국(구버전 vs 신버전 미러매치)은 같은 엔진 계열이라 같은 맹점을 공유해 실제 개선을 놓치는 경우가 많았다(2026-07-03~04에 여러 번 확인). 로컬에 설치된 독립 엔진 **Yixin**(Kai Sun, Gomocup 상위권, `C:\Yixin`)을 고정 기준점으로 삼아 이 문제를 해결하는 개발용 도구.

- Yixin의 `engine.exe`를 Gomocup pbrain 프로토콜(stdin/stdout)로 자식 프로세스로 띄워 `getAIMove`와 실시간 대국. GUI 불필요, 레포에 Yixin 바이너리는 포함하지 않음(로컬 전용)
- 렌주룰(`INFO rule 4`) 고정, `MY_COLOR=2`(백, 프로덕션과 동일 조건) 고정 — 자유룰은 흑 선공이 원래 압도적으로 유리해 "AI가 약한지" "자유룰이라 원래 이런지" 구분이 안 됐음
- `node tools/bench-vs-yixin.mjs [엔진모듈경로] [Yixin사고시간ms]` — 비교할 엔진 버전과 Yixin 사고시간(기본 500ms)을 인자로 조절 가능
- 결론은 항상 "이겼는가"가 아니라 "베이스라인 대비 승수/생존 수순이 늘었는가"로 판단 — Yixin은 압도적으로 강해 이기는 것 자체가 목표가 아님

---

## 6. 금수 판정 (렌주룰)

### 위치
`server/forbidden.js` (CJS, 온라인 대전 서버 측 판정) / `client/src/utils/forbidden.js` (ESM, 클라이언트 시각화용). **두 파일은 동일 로직 — 한쪽 수정 시 반드시 양쪽 반영**.

### 핵심 함수: `checkForbidden(board, row, col, evaluating = new Set())`

- 반환값: `'장목'` | `'44'` | `'33'` | `null`(금수 아님)
- 해당 좌표에 흑돌을 임시로 두고 장목 → 사(四) 2개 이상(44) → 열린삼 2개 이상(33) 순으로 검사한 뒤 원상 복구
- `evaluating`: 현재 재귀 호출 스택에서 평가 중인 좌표(`row*15+col`) 집합. 순환 재귀 방지용 안전장치 (일반적으로는 board 점유 상태 체크로도 이미 걸러짐)

### 거짓금수(false forbidden) 처리

렌주룰상 열린삼·사를 "완성"시키는 빈 자리가 그 자체로 금수(33/44/장목)이면, 진짜 삼·사로 인정하지 않는다. `_hasOpenThree`/`_hasFour` 모두 완성 자리에 대해 `checkForbidden`을 재귀 호출해 이를 검증하며, 순환이 없는 한 깊이 제한 없이 정확하게 재귀 검증한다 (과거엔 `depth < 2`로 임의 제한했던 버그가 있었음 — `docs/TROUBLESHOOTING.md` #4 참고).

### 시각화

`getForbiddenCells(board)` (client 전용) — 보드 전체를 스캔해 흑 차례에 금수인 좌표 목록을 반환하고, `Board.jsx`가 빨간 삼각형(▲)으로 표시한다.

백(2)에는 금수 규칙이 적용되지 않는다 (AI가 항상 백을 두는 이유이기도 함).

---

## 7. 랭킹전 / ELO 레이팅

### 위치
`server/ratings.js`

### 개요

- 시작 레이팅 1200, K=32 표준 ELO 공식(`calcElo`)으로 승/패/무 판정 후 자동 갱신
- `server/data/ratings.json`에 `{ [userId]: { rating, wins, losses, draws, nickname } }` 형태로 저장. 서버 프로세스 재시작에도 유지되지만 로컬 디스크 파일이라 배포 환경 이전 시 정식 DB로 전환 필요 (gitignore 처리되어 저장소에는 포함되지 않음 — 개발 환경마다 독립된 로컬 데이터)
- `userId`: 클라이언트가 `localStorage`에 저장한 UUID(`client/src/utils/userId.js`)를 소켓 연결 시 `auth`로 전달, 서버가 이를 레이팅 조회/갱신 키로 사용 — 계정/로그인 없는 익명 식별이라 브라우저·기기를 바꾸면 전적이 이어지지 않음

### 매칭 흐름

```
클라이언트 A: ranked:queue:join
    │
    ├─ 대기열에 상대 없음 → 대기열 등록, ranked:queue:status(position) 응답
    │
클라이언트 B: ranked:queue:join
    └─ 대기열에 A 있음 → A를 pop, status:'ranked_pending' 방 생성
         └─ A, B 모두에게 ranked:match:found({ roomId }) emit
              └─ 각자 ranked:join({ roomId })으로 실제 소켓 입장
                   └─ 둘 다 입장 완료 시 status:'playing' 전환, 타이머 시작
```

30초 내 양쪽 모두 입장하지 않으면 `ranked_pending` 방은 자동 삭제된다.

### 결과 반영

게임 종료 시(`applyRankedRating`) `type: 'ranked'` 방이면 승/패/무 결과를 ELO에 반영하고, 양쪽 소켓에 `rating:update`(변화량 + 신규 레이팅) emit. `Game.jsx`가 이를 받아 "내" `PlayerInfo` 카드의 레이팅 숫자 옆에 변화량(예: `1200 +32`)을 인라인으로 표시한다.

### 순위표

`GET /api/leaderboard`가 전적 있는 유저를 레이팅 순으로 상위 20명 반환하고 `Leaderboard.jsx`가 렌더링한다.

---

## 8. 포트 및 실행 환경

| 항목 | 값 |
|---|---|
| 클라이언트 포트 | 3000 |
| 서버 포트 | 4000 |
| Socket.io path | `/socket.io` |
| Node.js 최소 버전 | 18 이상 |

---

## 9. 알려진 제약사항

- **서버 재시작 시 게임 초기화**: 방/게임 상태를 메모리에만 보관하므로 서버 재시작 시 모든 방이 사라짐 (ELO 레이팅은 예외 — 7절 참고)
- **레이팅 파일 저장소는 임시방편**: `server/data/ratings.json` 단일 파일 읽기/쓰기 방식이라 동시 쓰기 경합이나 멀티 서버 확장을 고려하지 않음. 정식 서비스 전환 시 DB 필요
- **익명 식별 한계**: `userId`가 `localStorage` UUID라 브라우저 데이터 삭제나 기기 변경 시 레이팅 전적이 끊김 (계정 시스템 없음)
- **단일 서버**: 수평 확장 시 Socket.io 세션 공유를 위해 Redis adapter 필요
- **AI 성능**: depth-3 Minimax는 매 착수마다 최대 20개 후보 × 3수 = 클라이언트 CPU 사용. Web Worker에서 실행되어 페이지 자체가 멈추진 않지만, 저사양 기기에서는 착수까지 체감 지연이 있을 수 있음 (한계 및 개선 방향은 5절 참고)
