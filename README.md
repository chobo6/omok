# 온라인 오목

브라우저에서 바로 플레이하는 온라인 오목 게임.  
공개방에서 실시간으로 대전하거나 AI와 대국할 수 있고, 랭킹전으로 실력을 겨룰 수도 있습니다.

## 기능

- **온라인 1:1 대전** — 공개방 목록에서 클릭 한 번으로 바로 대전
- **관전 모드** — 진행 중인 공개방도 목록에 남아 "관전" 버튼으로 입장 가능 (읽기 전용)
- **랭킹전 / ELO 매칭** — 자동 매칭 큐, ELO 레이팅(1200 시작, K=32), 순위표(상위 20명) — 로그인 필요
- **Google 로그인** — Google Identity Services 기반 로그인, 게스트는 공개방/AI 대전만 가능
- **AI 대전** — Negamax + Alpha-Beta + 반복심화 + Transposition Table + VCF 강제 승리 탐색 기반 AI. 흑/백 직접 선택 가능, Web Worker에서 계산해 대국 중에도 채팅 등 다른 조작이 막히지 않음
- **실시간 채팅** — 게임 중 채팅 지원
- **턴 타이머** — 턴당 3분, 시간 초과 시 자동 패배
- **항복 / 재경기** — 언제든 항복하거나 재경기 요청 가능

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | React 18, Vite, CSS Modules |
| 백엔드 | Node.js, Express, Socket.io |
| 데이터베이스 | PostgreSQL (랭킹전 레이팅·기보 저장) |
| 인증 | Google Identity Services + httpOnly 쿠키 세션(JWT) |
| 게임 보드 | HTML Canvas |
| AI | Negamax + Alpha-Beta + 반복심화 + Transposition Table + VCF 위협 탐색 + 오프닝북, Web Worker로 실행 |
| 배포 | Docker, Kubernetes(kind 로컬 실습) |

## 시작하기

### 요구사항

- Node.js 18 이상
- Docker (랭킹전 레이팅·기보 저장용 로컬 PostgreSQL — 공개방 대전·AI 대전만 쓸 거면 없어도 됨)
- Google 로그인을 쓰려면 `client/.env`·`server/.env`에 Google OAuth 클라이언트 ID 설정 필요 (게스트로는 로그인 없이도 공개방/AI 대전 이용 가능)

### 설치 및 실행

`concurrently`로 서버·클라이언트를 터미널 1개에서 동시에 실행합니다.

```bash
npm install          # 루트 (concurrently)
npm run install:all  # server, client 의존성 설치

docker compose up -d db   # 로컬 Postgres (최초 1회, 랭킹전 쓸 경우)
npm run migrate --prefix server  # 스키마 적용 (최초 1회)

npm run dev          # 서버 + 클라이언트 동시 실행 (Ctrl+C로 둘 다 종료)
```

브라우저에서 `http://localhost:3000` 접속. DB 설계는 [DB 스키마 문서](docs/DB_SCHEMA.md) 참고.

### 온라인 대전하기

1. 로비 **공개방** 탭에서 **방 만들기** 클릭 → 상대 대기
2. 다른 사람이 공개방 목록에서 해당 방을 클릭 → 바로 입장, 게임 시작
3. 게임 시작 후에도 목록에 남은 방은 다른 사용자가 **관전** 버튼으로 입장해 구경할 수 있음

## 프로젝트 구조

```
omok/
├── server/
│   ├── index.js         # 서버 진입점 (Socket.io 이벤트)
│   ├── gameLogic.js     # 보드 생성, 5목 판정
│   ├── forbidden.js     # 렌주룰 금수 판정 (CJS)
│   ├── ratings.js       # ELO 레이팅 (PostgreSQL)
│   ├── games.js         # 랭킹전 기보 저장 (PostgreSQL)
│   ├── googleAuth.js    # Google 로그인 검증, 세션 발급
│   └── db/              # pg Pool, 스키마, 마이그레이션 스크립트
├── client/
│   └── src/
│       ├── pages/       # Lobby, Game, Leaderboard 화면
│       ├── components/  # Board, Chat, PlayerInfo
│       └── utils/       # AI 엔진(aiEngine.js) + Web Worker(aiWorker.js) + 오프닝북
├── tools/               # AI 벤치마크·오프닝북 생성 스크립트 (개발용)
├── k8s/                 # 쿠버네티스 매니페스트 (로컬 kind 실습용)
├── Dockerfile           # 멀티스테이지 빌드 (client 빌드 → server 이미지)
├── kind-config.yaml     # 로컬 kind 클러스터 설정
├── docker-compose.yml   # 로컬 개발용 PostgreSQL
└── docs/
    ├── PRD.md            # 제품 요구사항 문서
    ├── TECHNICAL_SPEC.md # 기술 설계서
    ├── DB_SCHEMA.md      # DB 스키마(ERD)
    ├── DEPLOY.md         # 로컬 쿠버네티스(kind) 배포 실습 기록
    └── TROUBLESHOOTING.md # 주요 버그 해결 기록
```

## 문서

- [PRD (제품 요구사항)](docs/PRD.md)
- [기술 설계서](docs/TECHNICAL_SPEC.md)
- [DB 스키마](docs/DB_SCHEMA.md)
- [배포 (로컬 쿠버네티스 실습)](docs/DEPLOY.md)
- [트러블슈팅 기록](docs/TROUBLESHOOTING.md)
