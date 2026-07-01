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

### 위치: `client/src/utils/aiEngine.js`

클라이언트에서 실행 (서버 부하 없음).

### 알고리즘 흐름

```
getAIMove(board, aiPlayer)
    │
    ├─ 1. 즉시 승리 수 탐색 → 있으면 즉시 반환
    ├─ 2. 즉시 방어 수 탐색 (상대 5목 차단) → 있으면 즉시 반환
    ├─ 3. 후보 수 생성 (기존 돌 주변 2칸 이내, 최대 20개)
    └─ 4. Minimax depth-3 + alpha-beta pruning → 최고 점수 수 반환
```

### 휴리스틱 점수표

| 패턴 | 점수 |
|---|---|
| 내 5목 | 100,000 |
| 상대 5목 위협 | 50,000 |
| 내 열린 4목 | 10,000 |
| 상대 열린 4목 | 8,000 |
| 내 열린 3목 | 1,000 |
| 상대 열린 3목 | 500 |
| 내 열린 2목 | 10 |

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
- **AI 성능**: depth-3 Minimax는 매 착수마다 최대 20개 후보 × 3수 = 클라이언트 CPU 사용, 저사양 기기에서 약간의 지연 가능
- **금수 룰 미적용**: 현재 흑의 33/44/장목 금지 미구현
