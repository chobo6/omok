# 온라인 오목 — Claude 브리핑

이 파일은 Claude Code가 이 프로젝트를 작업할 때 자동으로 읽는 컨텍스트 파일입니다.

## 프로젝트 한 줄 요약

브라우저 기반 실시간 온라인 오목 게임. React(Vite) 프론트엔드 + Express/Socket.io 백엔드.

## 포트

- 클라이언트: `3000` (Vite dev server)
- 서버: `4000` (Express + Socket.io)
- `/socket.io` 경로는 Vite가 4000으로 프록시함 (`vite.config.js` 참고)

## 실행 방법

```bash
# 루트에서 한 번에 (concurrently로 서버+클라이언트 동시 실행)
npm run dev
```

터미널을 따로 띄우려면 `cd server && npm run dev` / `cd client && npm run dev`.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `server/index.js` | Socket.io 이벤트 전체 처리, 방/타이머/채팅 관리 |
| `server/gameLogic.js` | 보드 생성, 5목 판정 (순수 함수) |
| `server/forbidden.js` | 렌주룰 금수 판정 CJS — 서버에서 사용 |
| `server/ratings.js` | ELO 레이팅 계산·저장 (`server/data/ratings.json` 파일 기반, gitignore 처리됨) |
| `client/src/pages/Game.jsx` | 게임 화면 핵심 로직 (온라인/AI 모드 통합) |
| `client/src/pages/Lobby.jsx` | 방 생성/입장/AI 선택/공개방 목록/랭킹전 큐 3탭 화면 |
| `client/src/pages/Leaderboard.jsx` | 랭킹전 순위표 페이지 (상위 20명) |
| `client/src/components/Board.jsx` | Canvas 오목판 렌더링, 금수 삼각형 표시 |
| `client/src/utils/aiEngine.js` | Negamax + Alpha-Beta + 반복심화 + Transposition Table + VCF 위협 탐색 AI (증분 평가함수, 렌주 금수 활용) |
| `client/src/utils/aiWorker.js` | aiEngine을 Web Worker에서 실행 (메인 스레드 블로킹 방지) |
| `client/src/utils/openingBook.js` | 로컬 Yixin 질의로 얻은 초반 4/6수째 오프닝북 (국면 일치 시에만 사용) |
| `tools/bench-vs-yixin.mjs` | 로컬 Yixin 엔진 상대 AI 실력 검증 벤치마크 (개발용, pbrain 프로토콜) |
| `client/src/utils/forbidden.js` | 렌주룰 금수 판정 ESM — 클라이언트에서 사용 |
| `client/src/utils/userId.js` | localStorage 기반 익명 UUID 발급 (랭킹전 소켓 auth용) |

## 코딩 컨벤션

- 스타일링: **CSS Modules** (`*.module.css`). Tailwind나 styled-components 사용하지 않음
- 상태 관리: React `useState` / `useRef`. 별도 상태 라이브러리 없음
- 모듈 시스템: 서버는 **CommonJS** (`require`), 클라이언트는 **ESM** (`import`)
- UI 텍스트: **한국어**
- 주석: 필요한 경우에만 한국어로 작성

## 게임 데이터 구조

- 보드: `number[][]` (15×15). `0`=빈칸, `1`=흑, `2`=백
- 플레이어 번호: 방 생성자=1(흑), 입장자=2(백)
- 방/게임 상태는 메모리(`Map`)에만 저장 — DB 없음, 서버 재시작 시 초기화
- ELO 레이팅만 예외적으로 `server/data/ratings.json` 파일에 영구 저장 (DB 아님, 로컬 디스크 파일 — gitignore 처리되어 머신마다 독립적)

## Socket.io 이벤트 요약

클라이언트→서버: `room:create`(`type: 'private'|'public'`), `room:join`, `game:move`, `game:surrender`, `game:rematch`, `chat:send`, `ranked:queue:join`, `ranked:queue:leave`, `ranked:join`, `profile:get`

서버→클라이언트: `room:created`, `room:joined`, `room:error`, `room:state`, `timer:tick`, `game:over`, `game:restarted`, `game:rematch_requested`, `chat:message`, `ranked:queue:status`, `ranked:match:found`, `rating:update`, `profile:data`

REST: `GET /api/rooms` (공개방 목록 폴링), `GET /api/leaderboard` (랭킹 상위 20명)

자세한 payload는 `docs/TECHNICAL_SPEC.md` 참고.

## 알려진 제약 / 주의사항

- 서버 재시작 시 모든 방 초기화 (in-memory)
- **금수 룰**: 렌주룰 적용. 흑의 33/44/장목 착수 시 즉시 패배. 거짓금수(삼·사 완성 자리가 그 자체로 금수면 진짜로 인정 안 함) 허용 — `evaluating` Set으로 순환만 방지하고 깊이 제한 없이 재귀 검증
- 금수 판정 로직은 서버(`server/forbidden.js` CJS)와 클라이언트(`client/src/utils/forbidden.js` ESM) 양쪽에 동일 로직으로 존재. 수정 시 둘 다 반영해야 함
- AI는 클라이언트에서 실행 (서버 AI 없음). AI(백)는 금수 제한 없음
- AI 연산(`getAIMove`)은 `Game.jsx`가 직접 호출하지 않고 `aiWorker.js`(Web Worker)에 위임됨. `postMessage`로 board 전달 → worker가 계산 → 결과만 반환
- `Game.jsx`에서 소켓 이벤트 핸들러는 stale closure 방지를 위해 `useRef` 패턴 사용

## 참고 문서

- `docs/PRD.md` — 기능 요구사항 전체
- `docs/TECHNICAL_SPEC.md` — 아키텍처, API 명세, AI 설명
- `docs/TROUBLESHOOTING.md` — 금수 패배처리·타이머 등 주요 버그 해결 기록
