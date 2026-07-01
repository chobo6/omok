# 온라인 오목

브라우저에서 바로 플레이하는 온라인 오목 게임.  
친구와 방 코드로 실시간 대전하거나 AI와 대국할 수 있습니다.

## 기능

- **온라인 1:1 대전** — 6자리 방 코드를 친구에게 공유해 바로 대전
- **AI 대전** — Minimax(3수 앞 탐색) + VCF 강제 승리 탐색 기반 AI, Web Worker에서 계산해 대국 중에도 채팅 등 다른 조작이 막히지 않음
- **실시간 채팅** — 게임 중 채팅 지원
- **턴 타이머** — 턴당 3분, 시간 초과 시 자동 패배
- **항복 / 재경기** — 언제든 항복하거나 재경기 요청 가능

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | React 18, Vite, CSS Modules |
| 백엔드 | Node.js, Express, Socket.io |
| 게임 보드 | HTML Canvas |
| AI | Minimax + alpha-beta pruning + VCF 위협 탐색, Web Worker로 실행 |

## 시작하기

### 요구사항

- Node.js 18 이상

### 설치 및 실행

`concurrently`로 서버·클라이언트를 터미널 1개에서 동시에 실행합니다.

```bash
npm install          # 루트 (concurrently)
npm run install:all  # server, client 의존성 설치
npm run dev          # 서버 + 클라이언트 동시 실행 (Ctrl+C로 둘 다 종료)
```

브라우저에서 `http://localhost:3000` 접속

### 온라인 대전하기

1. 한 명이 **방 만들기** 클릭 → 6자리 방 코드 확인
2. 코드를 친구에게 공유
3. 친구가 **방 코드 입력** 후 입장 → 게임 시작

## 프로젝트 구조

```
omok/
├── server/
│   ├── index.js         # 서버 진입점 (Socket.io 이벤트)
│   └── gameLogic.js     # 보드 생성, 5목 판정
├── client/
│   └── src/
│       ├── pages/       # Lobby, Game 화면
│       ├── components/  # Board, Chat, PlayerInfo
│       └── utils/       # AI 엔진(aiEngine.js) + Web Worker(aiWorker.js)
└── docs/
    ├── PRD.md           # 제품 요구사항 문서
    └── TECHNICAL_SPEC.md # 기술 설계서
```

## 문서

- [PRD (제품 요구사항)](docs/PRD.md)
- [기술 설계서](docs/TECHNICAL_SPEC.md)
