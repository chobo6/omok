# Google OAuth 인증 설계

> **작성일**: 2026-07-08
> **상태**: 설계 승인됨 — 구현 대기

## 배경

현재 사용자 식별은 `client/src/utils/userId.js`가 localStorage에 발급하는 랜덤 UUID뿐이다. 이 UUID를 `server/ratings.js`가 키로 삼아 ELO 레이팅·전적을 저장한다. 브라우저/기기를 바꾸면 UUID가 새로 발급되어 전적이 끊기는 문제가 `docs/PRD.md`에 이미 향후 과제로 명시돼 있다.

추가로, 서버는 소켓 핸드셰이크에서 클라이언트가 보낸 `userId`를 별도 검증 없이 그대로 신뢰한다(`server/index.js`의 `socket.handshake.auth.userId`) — 임의의 클라이언트가 다른 사람의 `userId`를 자칭해 그 사람의 레이팅으로 랭킹전에 참가할 수 있는 구조적 허점이다.

## 목적

1. **기기 간 전적 유지** — 로그인하면 어느 기기에서든 같은 계정/레이팅으로 이어짐
2. **부수 목표: userId 스푸핑 방지** — 소켓/REST 인증을 서버가 검증하는 구조로 교체

로그인은 **Google 소셜 로그인만** 지원한다(카카오 등 추가 공급자는 범위 밖). 로그인하지 않은 **게스트도 계속 지원**하되, 공개방 생성/입장과 AI 대전만 가능하고 **랭킹전은 로그인 필수**로 막는다.

## 세션 전략: httpOnly 쿠키

Google Identity Services(GIS)로 클라이언트가 ID 토큰을 받아 서버에 전달 → 서버가 `google-auth-library`로 서명 검증(클라이언트 시크릿 불필요, Client ID만 필요) → 서버가 자체 세션 JWT를 발급해 **httpOnly + sameSite=lax** 쿠키로 심는다.

대안으로 "서버가 발급한 JWT를 클라이언트가 localStorage에 들고 있다가 매 요청에 첨부"하는 방식(기존 `handshake.auth` 패턴 재사용, CORS 변경 불필요)도 검토했으나, 이번에 인증 시스템을 새로 만드는 김에 기존 userId 스푸핑 허점도 함께 막기 위해 httpOnly 쿠키를 채택한다. 트레이드오프로 `server/index.js`의 `cors: { origin: '*' }`를 실제 origin 목록 + `credentials: true`로 바꿔야 한다.

## 전체 흐름

### 로그인
1. `Lobby.jsx`에 "Google로 로그인" 버튼 — GIS SDK(`accounts.google.com/gsi/client`) 로드 후 `google.accounts.id.initialize({ client_id, callback })`으로 버튼 렌더링
2. 로그인 성공 시 GIS 콜백으로 ID 토큰(credential, JWT) 수신
3. 클라이언트가 `POST /api/auth/google { credential }` 호출
4. 서버가 `google-auth-library`의 `OAuth2Client.verifyIdToken`으로 서명·audience 검증 → `{ sub, email, name }` 추출
5. `sub` 기준으로 유저 조회/생성(신규면 레이팅 1200, 닉네임=Google `name`으로 초기화)
6. 서버가 세션 JWT(`{ userId }`, 만료 30일)를 서명해 httpOnly 쿠키로 응답에 심음
7. 클라이언트는 `GET /api/auth/me`로 로그인 상태·프로필(닉네임, 레이팅) 조회
8. `POST /api/auth/logout` — 쿠키 삭제

### 소켓 인증
- `io.use((socket, next) => {...})` 미들웨어가 핸드셰이크의 쿠키 헤더를 파싱해 세션 JWT 검증 → 성공 시 `socket.data.userId = <검증된 userId>`, 실패/미제공 시 `socket.data.userId = null`(게스트)
- 서버 코드 전반의 `const { userId } = socket.handshake.auth` (클라이언트가 직접 주장하는 값)를 전부 `socket.data.userId`(서버가 검증한 값)로 교체
- 클라이언트는 더 이상 소켓 핸드셰이크에 `userId`를 보내지 않는다 — socket.io-client에 `withCredentials: true`를 설정해 쿠키가 자동으로 전송되게 한다

### 랭킹전 게이트
- `ranked:queue:join` 등 랭킹 관련 핸들러 진입부에서 `if (!socket.data.userId) { socket.emit('room:error', { message: '로그인이 필요합니다.' }); return }` 가드 추가
- 공개방(`room:create` type:'public', `room:join`, `room:spectate`)과 AI 모드는 게스트도 그대로 이용 가능(변경 없음)

## 데이터 모델

기존 `server/ratings.js`(JSON 파일 기반 `getProfile/applyResult/getLeaderboard`, `server/data/ratings.json`)는 구조를 바꾸지 않는다. 대신 새 모듈 `server/googleAuth.js`를 추가해 다음을 관리한다:

- `server/data/users.json` — `{ "<googleSub>": { "userId": "u_xxxxx", "email": "...", "name": "...", "createdAt": ... } }` 형태로 "googleSub → 내부 userId" 매핑을 보관
- 로그인 시 이 매핑에서 `userId`를 얻어 기존 `ratings.js`의 `getProfile(userId, nickname)`을 그대로 호출 — 레이팅/전적 저장 로직은 수정 없음

기존에 익명 UUID로 쌓인 랭킹전 기록(`ratings.json`)은 손대지 않는다. 게스트가 더 이상 랭킹전에 참여할 수 없으므로 이후 새로 늘어나지 않을 뿐, 과거 기록을 계정에 연결하는 마이그레이션은 이번 범위 밖이다.

## 게스트 처리

- `client/src/utils/userId.js`(localStorage UUID 발급)는 제거한다 — 게스트는 서버가 인증된 userId를 발급하지 않으므로 더 이상 필요 없다
- 새 `client/src/utils/guestNickname.js`가 형용사+명사 목록을 조합해 임의 두 단어 닉네임을 생성한다(예: "조용한너구리"). 게스트가 방에 입장할 때 기존의 자유 입력 닉네임 필드 대신 이 값을 사용한다. 닉네임은 `sessionStorage`에 저장해 같은 브라우저 탭 세션 안에서는 재입장/재연결해도 유지되고, 탭을 새로 열면 다시 생성된다(게스트에게 영속적 정체성을 부여하지 않는다는 원칙 유지)
- 로그인한 사용자는 Google 프로필 이름을 기본 닉네임으로 사용한다. 닉네임을 직접 편집하는 UI는 이번 범위 밖(향후 과제)
- `Lobby.jsx`의 랭킹전 탭은 비로그인 상태일 때 큐 등록 UI 대신 "로그인이 필요합니다" 안내 + 로그인 버튼으로 대체한다
- AI 대전은 서버 통신이 없으므로 게스트/로그인 여부와 무관하게 기존 그대로 동작한다

## 서버 변경점

- 의존성 추가: `cookie-parser`, `google-auth-library`, `jsonwebtoken`, `dotenv`
- `server/index.js`:
  - `cors({ origin: '*' })` → 실제 클라이언트 origin(개발: `http://localhost:3000`, 배포 origin은 별도 환경변수) + `credentials: true`
  - `cookie-parser` 미들웨어 추가
  - 신규 라우트: `POST /api/auth/google`, `GET /api/auth/me`, `POST /api/auth/logout`
  - `io.use()` 소켓 인증 미들웨어 추가
  - `socket.handshake.auth.userId` 참조를 전부 `socket.data.userId`로 교체
  - `ranked:queue:join` 등에 로그인 가드 추가
- 신규 `server/googleAuth.js`: ID 토큰 검증, 세션 JWT 발급/검증, `users.json` 읽기/쓰기
- 환경변수(`server/.env`, gitignore): `GOOGLE_CLIENT_ID`, `SESSION_JWT_SECRET`, `CLIENT_ORIGIN`

## 클라이언트 변경점

- 신규 `client/src/utils/auth.js`: GIS 스크립트 로드, 로그인 버튼 렌더링 트리거, `login()`/`logout()`/`fetchMe()` 함수
- 신규 `client/src/utils/guestNickname.js`: 랜덤 두 단어 닉네임 생성
- `client/src/utils/userId.js` 제거
- `client/src/pages/Lobby.jsx`: 로그인 상태 표시(로그인 버튼 또는 "닉네임님, 레이팅 N"), 게스트 닉네임 입력란을 자동 생성 임시 닉네임으로 대체, 랭킹전 탭 로그인 게이트
- socket.io-client 연결 옵션에 `withCredentials: true` 추가
- 환경변수(`client/.env`): `VITE_GOOGLE_CLIENT_ID`(공개값)

## 범위 밖 (향후 과제)

- 카카오/네이버 등 추가 소셜 로그인 공급자
- 로그인 사용자의 닉네임 직접 편집 UI
- 기존 익명 UUID 랭킹 기록을 로그인 계정에 연결하는 마이그레이션
- 세션 갱신/리프레시 토큰(현재는 30일 고정 만료 후 재로그인으로 단순 처리)
- Google 프로필 사진 표시, 친구 목록 등 부가 기능

## 검증 방법

1. Google 로그인 → `GET /api/auth/me`에서 올바른 프로필 반환 확인
2. 로그아웃 → 쿠키 삭제, `/api/auth/me`가 비로그인 상태 반환 확인
3. 게스트로 공개방 생성/입장, AI 대전 정상 동작 확인(회귀 없음)
4. 게스트로 랭킹전 큐 등록 시도 → 서버가 거부하고 안내 메시지 확인
5. 로그인 후 랭킹전 참여 → 레이팅 갱신이 계정에 귀속되는지 확인, 다른 브라우저(쿠키 없는 세션)에서 같은 계정으로 로그인해 레이팅이 이어지는지 확인
6. 소켓 핸드셰이크에 조작된 `userId`를 직접 실어 보내는 테스트 → 더 이상 그 값이 반영되지 않고 서버 검증값만 쓰이는지 확인(스푸핑 방지 확인)
7. `npx vite build` 정상 통과
