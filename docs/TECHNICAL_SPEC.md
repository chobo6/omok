# 기술 설계서 — 온라인 오목

> **버전**: 1.0  
> **작성일**: 2026-07-01

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
│   ├── index.js          # Express + Socket.io 서버 진입점
│   └── gameLogic.js      # 순수 게임 로직 (보드 생성, 5목 판정)
│
├── client/
│   ├── vite.config.js    # Vite 설정 + /socket.io 프록시
│   └── src/
│       ├── App.jsx        # 페이지 라우팅 (lobby ↔ game)
│       ├── pages/
│       │   ├── Lobby.jsx  # 방 생성/입장/AI 대전 선택
│       │   └── Game.jsx   # 게임 화면 (보드, 채팅, 타이머 통합)
│       ├── components/
│       │   ├── Board.jsx      # Canvas 오목판 렌더링
│       │   ├── Chat.jsx       # 채팅 UI
│       │   └── PlayerInfo.jsx # 플레이어 정보 + 타이머
│       └── utils/
│           └── aiEngine.js    # Minimax AI (클라이언트 사이드)
│
└── docs/
    ├── PRD.md
    └── TECHNICAL_SPEC.md
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
  status: 'waiting' | 'playing' | 'ended',
  lastMove: { row, col, player } | null,
  chat: { nickname, message, time }[],
  timers: { [socketId]: number },   // 남은 시간(초)
  timerInterval: NodeJS.Timeout,
  rematchVotes: Set<string>,        // 재경기 동의 socketId
}
```

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

### 클라이언트 → 서버 (emit)

| 이벤트 | payload | 설명 |
|---|---|---|
| `room:create` | `{ nickname }` | 새 방 생성 |
| `room:join` | `{ roomId, nickname }` | 방 입장 |
| `game:move` | `{ row, col }` | 착수 |
| `game:surrender` | — | 항복 |
| `game:rematch` | — | 재경기 요청 |
| `chat:send` | `{ message }` | 채팅 전송 |

### 서버 → 클라이언트 (emit)

| 이벤트 | payload | 설명 |
|---|---|---|
| `room:created` | `{ roomId }` | 방 생성 완료, 코드 전달 |
| `room:joined` | `{ roomId }` | 방 입장 성공 |
| `room:error` | `{ message }` | 입장 실패 사유 |
| `room:state` | RoomState | 보드/턴/타이머 전체 상태 동기화 |
| `timer:tick` | `{ socketId, timeLeft }` | 매초 타이머 갱신 |
| `game:over` | `{ winner, winnerId, reason }` | 게임 종료 |
| `game:rematch_requested` | `{ by }` | 상대방 재경기 요청 알림 |
| `game:restarted` | — | 재경기 시작 |
| `chat:message` | `{ nickname, message, time }` | 채팅 수신 |

#### `room:state` payload 구조

```ts
{
  board: number[][],
  players: {
    id: string,
    color: 'black' | 'white',
    nickname: string,
    timeLeft: number,
  }[],
  currentTurn: 1 | 2,
  status: 'waiting' | 'playing' | 'ended',
  lastMove: { row, col, player } | null,
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

## 6. 포트 및 실행 환경

| 항목 | 값 |
|---|---|
| 클라이언트 포트 | 3000 |
| 서버 포트 | 4000 |
| Socket.io path | `/socket.io` |
| Node.js 최소 버전 | 18 이상 |

---

## 7. 알려진 제약사항

- **서버 재시작 시 게임 초기화**: 상태를 메모리에만 보관하므로 서버 재시작 시 모든 방이 사라짐
- **단일 서버**: 수평 확장 시 Socket.io 세션 공유를 위해 Redis adapter 필요
- **AI 성능**: depth-3 Minimax는 매 착수마다 최대 20개 후보 × 3수 = 클라이언트 CPU 사용. Web Worker에서 실행되어 페이지 자체가 멈추진 않지만, 저사양 기기에서는 착수까지 체감 지연이 있을 수 있음 (한계 및 개선 방향은 5절 참고)
