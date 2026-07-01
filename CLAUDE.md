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
# 서버 (터미널 1)
cd server && npm run dev

# 클라이언트 (터미널 2)
cd client && npm run dev
```

## 주요 파일

| 파일 | 역할 |
|---|---|
| `server/index.js` | Socket.io 이벤트 전체 처리, 방/타이머/채팅 관리 |
| `server/gameLogic.js` | 보드 생성, 5목 판정 (순수 함수) |
| `client/src/pages/Game.jsx` | 게임 화면 핵심 로직 (온라인/AI 모드 통합) |
| `client/src/pages/Lobby.jsx` | 방 생성/입장/AI 선택 화면 |
| `client/src/components/Board.jsx` | Canvas 오목판 렌더링 |
| `client/src/utils/aiEngine.js` | Minimax + alpha-beta pruning AI |

## 코딩 컨벤션

- 스타일링: **CSS Modules** (`*.module.css`). Tailwind나 styled-components 사용하지 않음
- 상태 관리: React `useState` / `useRef`. 별도 상태 라이브러리 없음
- 모듈 시스템: 서버는 **CommonJS** (`require`), 클라이언트는 **ESM** (`import`)
- UI 텍스트: **한국어**
- 주석: 필요한 경우에만 한국어로 작성

## 게임 데이터 구조

- 보드: `number[][]` (15×15). `0`=빈칸, `1`=흑, `2`=백
- 플레이어 번호: 방 생성자=1(흑), 입장자=2(백)
- 서버 상태는 메모리(`Map`)에만 저장 — DB 없음

## Socket.io 이벤트 요약

클라이언트→서버: `room:create`, `room:join`, `game:move`, `game:surrender`, `game:rematch`, `chat:send`

서버→클라이언트: `room:created`, `room:joined`, `room:error`, `room:state`, `timer:tick`, `game:over`, `game:restarted`, `game:rematch_requested`, `chat:message`

자세한 payload는 `docs/TECHNICAL_SPEC.md` 참고.

## 알려진 제약 / 주의사항

- 서버 재시작 시 모든 방 초기화 (in-memory)
- 금수 룰 미구현 (PRD 향후 과제 참고)
- AI는 클라이언트에서 실행 (서버 AI 없음)
- `Game.jsx`에서 소켓 이벤트 핸들러는 stale closure 방지를 위해 `useRef` 패턴 사용

## 참고 문서

- `docs/PRD.md` — 기능 요구사항 전체
- `docs/TECHNICAL_SPEC.md` — 아키텍처, API 명세, AI 설명
