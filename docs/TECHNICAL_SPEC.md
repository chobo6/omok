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
│       │   ├── Lobby.jsx       # 비공개방/공개방/랭킹전 3탭 + AI 대전 선택
│       │   ├── Game.jsx        # 게임 화면 (보드, 채팅, 타이머, 레이팅 통합)
│       │   └── Leaderboard.jsx # 랭킹 순위표
│       ├── components/
│       │   ├── Board.jsx      # Canvas 오목판 렌더링, 금수 삼각형 표시
│       │   ├── Chat.jsx       # 채팅 UI
│       │   └── PlayerInfo.jsx # 플레이어 정보 + 타이머 + 레이팅 배지
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
  type: 'private' | 'public' | 'ranked',
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

### 클라이언트 접속 시 `auth`

소켓 연결 시 `{ auth: { userId } }`로 `userId`(localStorage UUID, `client/src/utils/userId.js`)를 전달. 서버는 `socket.handshake.auth.userId`로 레이팅 조회/갱신 키를 식별 (없으면 레이팅 관련 기능 비활성).

### 클라이언트 → 서버 (emit)

| 이벤트 | payload | 설명 |
|---|---|---|
| `room:create` | `{ nickname, type: 'private' \| 'public' }` | 새 방 생성 |
| `room:join` | `{ roomId, nickname }` | 방 입장 (코드 또는 공개방 목록에서) |
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
| `game:over` | `{ winner, winnerId, reason }` | 게임 종료 (랭킹전이면 서버가 내부적으로 ELO 갱신 후 `rating:update`도 emit) |
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
| `GET /api/rooms` | `status: 'waiting'`인 공개방(`type: 'public'`) 목록. 클라이언트가 로비에서 폴링 |
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
  roomType: 'private' | 'public' | 'ranked',
}
```

#### `game:over` reason 값

| reason | 설명 |
|---|---|
| `win` | 5목 달성 |
| `draw` | 보드 전체 채움 |
| `timeout` | 타이머 0초 |
| `surrender` | 항복 |
| `disconnect` | 상대방 연결 끊김 |

---

## 5. AI 엔진

### 위치: `client/src/utils/aiEngine.js` (연산 본체), `client/src/utils/aiWorker.js` (실행 스레드)

`getAIMove` 자체는 클라이언트에서 실행되지만(서버 부하 없음), Web Worker 위에서 돌아가 메인(UI) 스레드를 막지 않는다. AI는 항상 백(2)으로 두며 금수 제한을 받지 않는다.

### 구현된 알고리즘 흐름

```
getAIMove(board, aiPlayer)
    │
    ├─ 0. 오프닝: 보드에 돌이 1개(상대 첫 수)뿐이면 3x3 반경 내 랜덤 응수
    ├─ 1. 즉시 승리 수 탐색 → 있으면 즉시 반환
    ├─ 2. 즉시 방어 수 탐색 (상대 5목 완성 차단) → 있으면 즉시 반환
    ├─ 3. VCF(연속사 강제 승리) 탐색 → 강제 승리 수순이 있으면 그 첫 수 반환
    ├─ 4. 후보 수 생성 (기존 돌 주변 2칸 이내 빈 칸, 중복 제거)
    ├─ 5. 후보를 scoreCell 휴리스틱으로 정렬 후 상위 20개만 선별
    └─ 6. 각 후보에 대해 Minimax depth-3 + alpha-beta pruning 실행 → 최고 점수 수 반환
```

- **오프닝 다양화(`getOpeningMove`)**: 오목의 관례상 흑의 첫 수는 항상 정중앙이라, AI의 첫 응수가 매번 똑같으면 패턴이 뻔해짐. 상대 돌이 1개뿐인 국면에서는 그 돌 기준 상하좌우·대각선 1칸(3x3, 중심 제외) 중 무작위로 응수해 개국을 다양화
- **Threat Search(`searchVCF`/`findFourMoves`/`getFourThreats`)**: VCF(Victory by Continuous Fours) 탐색. 사(四)를 만드는 수만 후보로 좁혀, 완성 지점이 2곳 이상(더블사·열린사)이면 즉시 승리 확정, 1곳뿐이면 상대가 그 자리를 막는다고 가정하고 재귀적으로 다음 사를 탐색. depth-3 Minimax가 놓치는 종반 강제 승리 수순을 찾아냄. 상대의 반격(더 빠른 승리) 가능성은 별도로 검증하지 않는 단순화된 탐색
- **후보 생성(`getCandidates`)**: 놓인 돌 기준 반경 2칸 이내 빈 칸만 탐색 대상으로 삼아 탐색 공간을 축소
- **사전 정렬(`sortedCandidates`)**: depth-3 Minimax는 비용이 크므로 상위 20개 후보에만 적용
- **평가 함수(`scoreCell`/`buildLine`/`analyzeDirection`)**: 4방향에 대해 중심 돌 기준 반경 4칸(9칸) 라인을 뽑고, 그 안에서 5칸짜리 창을 슬라이딩하며 상대 돌 없이 내 돌이 몇 개·빈칸이 몇 개인지로 위협을 판정. 연속된 패턴(`XXXX`)뿐 아니라 `XX.XX`, `.XXX.` 같은 끊긴(gap) 패턴도 동일한 방식으로 잡아내며, 같은 모양이 몇 개의 창에서 동시에 성립하는지(`fourWindows`/`threeWindows`)로 열린/막힌 여부를 근사 판정
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

- **고정 depth**: 게임 진행 단계(초반/중반/종반)와 무관하게 항상 depth-3만 탐색 (VCF가 종반 강제 승리 수순 일부를 보완하지만 전체를 대체하진 않음)
- **탐색 결과 재사용 없음**: 매 착수마다 Minimax를 처음부터 다시 계산 (Transposition Table 없음)
- **난이도 고정**: PRD에 계획된 "쉬움/보통/어려움" depth 선택 기능 미구현 (`docs/PRD.md` 4절 참고)
- **VCF의 상대 반격 미검증**: `searchVCF`는 상대가 항상 사(四)의 완성 지점만 막는다고 가정할 뿐, 상대가 그 대신 더 빠르게 이길 수 있는지는 확인하지 않는 단순화된 탐색 (VCT처럼 공격·방어를 모두 고려하는 완전한 탐색은 아님)

### 성능 개선 방향 (향후 과제, 우선순위 순)

1. **반복 심화(Iterative Deepening) + 시간 제한** — 고정 depth-3 대신 남은 시간 예산 안에서 depth를 1→2→3…으로 점진적으로 늘려 상황에 맞는 깊이 확보
2. **Zobrist Hashing + Transposition Table** — 동일/유사 국면 재계산 방지로 탐색 속도 개선, 확보한 여유를 depth 증가에 재투자
3. **Killer Move / History Heuristic 후보 정렬** — 이전 탐색에서 유효했던 수를 우선 시도해 alpha-beta 가지치기 효율 향상
4. **VCT(사·삼을 함께 고려하는 확장 위협 탐색)** — 현재 VCF(사만 연속)보다 넓게, 열린 삼도 강제 수순에 포함시켜 종반 승률 추가 향상
5. **난이도별 depth 조절 기능 구현** — PRD 4절의 "AI 난이도 선택" 요구사항 반영 (쉬움 depth-1 / 보통 depth-3 / 어려움 depth-5)

### 완료된 개선 항목

- ~~끊긴 패턴(gap) 평가 보강~~ — `scoreCell`이 `countLine`(연속 카운트) 방식에서 `buildLine`+`analyzeDirection`(5칸 슬라이딩 윈도우) 방식으로 교체되어 `XX.XX`/`.XXX.` 같은 끊긴 삼·사 위협도 인식
- ~~Web Worker로 이전~~ — `aiWorker.js` 추가, `Game.jsx`가 메인 스레드 대신 워커에 계산을 위임. 착수 연산 중에도 페이지가 멈추지 않고 채팅 등 다른 UI 조작이 가능해짐
- ~~VCF(연속사 강제 승리) 탐색 추가~~ — `searchVCF`로 depth-3 Minimax가 못 보는 종반 강제 승리 수순을 찾아냄 (완전한 VCT는 아님, 위 한계 참고)

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

게임 종료 시(`applyRankedRating`) `type: 'ranked'` 방이면 승/패/무 결과를 ELO에 반영하고, 양쪽 소켓에 `rating:update`(변화량 + 신규 레이팅) emit. `Game.jsx`가 이를 받아 종료 모달에 레이팅 변화(예: `+32 → 1232`)를 표시한다.

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
