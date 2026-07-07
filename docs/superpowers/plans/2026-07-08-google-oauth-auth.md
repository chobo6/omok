# Google OAuth 인증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google 소셜 로그인으로 로그인한 사용자의 전적(ELO 레이팅)이 기기를 바꿔도 유지되게 하고, 게스트는 공개방/AI 대전만 이용하도록 제한한다.

**Architecture:** 클라이언트가 Google Identity Services(GIS)로 ID 토큰을 받아 서버에 전달 → 서버가 `google-auth-library`로 검증 후 자체 세션 JWT를 httpOnly 쿠키로 발급 → 이후 REST/소켓 요청은 이 쿠키로 인증한다. 기존에 클라이언트가 직접 주장하던 `socket.handshake.auth.userId`(스푸핑 가능)를 서버가 쿠키에서 검증한 `socket.data.userId`로 대체한다.

**Tech Stack:** Express 5, Socket.io 4, React 19(Vite), `google-auth-library`, `jsonwebtoken`, `cookie-parser`, `dotenv`. 새 테스트는 프로젝트에 기존 테스트 프레임워크가 없으므로(설치된 의존성 없음) Node 내장 `node:test` + `node:assert/strict`를 사용한다(신규 의존성 불필요, `node --version` 확인 결과 v24.12.0으로 지원됨).

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-07-08-google-oauth-auth-design.md` — 이 플랜의 모든 결정은 이 스펙을 따른다
- Google 소셜 로그인만 지원(카카오 등 추가 공급자는 범위 밖)
- 게스트는 공개방 생성/입장, AI 대전만 허용. 랭킹전은 로그인 필수
- 게스트 닉네임: 형용사+명사 랜덤 조합, `sessionStorage`에 저장(탭 세션 동안만 유지, 영속 정체성 없음)
- 세션: httpOnly + sameSite=lax 쿠키, 만료 30일
- 기존 `server/ratings.js`의 레이팅 저장 로직·데이터 구조는 변경하지 않는다 — googleSub→userId 매핑만 새 레이어로 추가
- `server/data/`, `.env`는 이미 `.gitignore` 처리되어 있음(신규 파일 추가 시 별도 조치 불필요)
- 코딩 컨벤션(`CLAUDE.md`): 서버는 CommonJS(`require`), 클라이언트는 ESM(`import`); UI 텍스트는 한국어; 주석은 필요한 경우에만 한국어로

---

### Task 1: 서버 의존성 + 환경변수 스캐폴딩

**Files:**
- Modify: `server/package.json`
- Create: `server/.env.example`
- Create: `client/.env.example`

**Interfaces:**
- Produces: `SESSION_JWT_SECRET`, `GOOGLE_CLIENT_ID`, `CLIENT_ORIGIN` 환경변수(서버), `VITE_GOOGLE_CLIENT_ID`(클라이언트) — 이후 태스크가 `process.env.*`/`import.meta.env.*`로 사용

- [ ] **Step 1: 서버에 의존성 설치**

Run: `cd server && npm install cookie-parser google-auth-library jsonwebtoken dotenv`

Expected: `server/package.json`의 `dependencies`에 4개 패키지 추가됨

- [ ] **Step 2: `server/.env.example` 작성**

```
# 실제 값은 .env에 넣고 커밋하지 않는다(.gitignore에 이미 등록됨)
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
SESSION_JWT_SECRET=change-me-to-a-long-random-string
CLIENT_ORIGIN=http://localhost:3000
```

- [ ] **Step 3: `client/.env.example` 작성**

```
# Google OAuth Client ID는 공개값이라 노출돼도 안전하다(클라이언트 시크릿 아님)
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

- [ ] **Step 4: 커밋**

```bash
git add server/package.json server/package-lock.json server/.env.example client/.env.example
git commit -m "chore: Google OAuth 인증에 필요한 의존성·환경변수 예시 추가"
```

---

### Task 2: `server/googleAuth.js` — 사용자 매핑 + 세션 JWT (TDD)

**Files:**
- Create: `server/googleAuth.js`
- Test: `server/googleAuth.test.js`

**Interfaces:**
- Consumes: `jsonwebtoken`(npm), `crypto`(node 내장), `process.env.SESSION_JWT_SECRET`
- Produces:
  - `resolveUserId(db, googleSub, {email, name}) → string` — 순수 함수, db 객체를 직접 변형
  - `getOrCreateUserId(googleSub, {email, name}) → string` — 파일 I/O 포함 버전(`server/data/users.json`)
  - `signSession(userId) → string`(JWT)
  - `verifySession(token) → string|null`(userId 또는 무효 시 null)
  - 이 네 함수를 Task 4/5가 `server/index.js`에서 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`server/googleAuth.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveUserId, signSession, verifySession } = require('./googleAuth')

test('resolveUserId creates a new user on first login', () => {
  const db = {}
  const userId = resolveUserId(db, 'google-sub-1', { email: 'a@example.com', name: 'Alice' })
  assert.match(userId, /^u_/)
  assert.strictEqual(db['google-sub-1'].userId, userId)
  assert.strictEqual(db['google-sub-1'].email, 'a@example.com')
  assert.strictEqual(db['google-sub-1'].name, 'Alice')
})

test('resolveUserId returns the same userId for repeat logins', () => {
  const db = {}
  const first = resolveUserId(db, 'google-sub-2', { email: 'b@example.com', name: 'Bob' })
  const second = resolveUserId(db, 'google-sub-2', { email: 'b@example.com', name: 'Bob' })
  assert.strictEqual(first, second)
})

test('resolveUserId updates email/name on repeat login without changing userId', () => {
  const db = {}
  const first = resolveUserId(db, 'google-sub-3', { email: 'old@example.com', name: 'Old Name' })
  const second = resolveUserId(db, 'google-sub-3', { email: 'new@example.com', name: 'New Name' })
  assert.strictEqual(first, second)
  assert.strictEqual(db['google-sub-3'].email, 'new@example.com')
  assert.strictEqual(db['google-sub-3'].name, 'New Name')
})

test('resolveUserId keeps separate users independent', () => {
  const db = {}
  const a = resolveUserId(db, 'google-sub-a', { email: 'a@example.com', name: 'A' })
  const b = resolveUserId(db, 'google-sub-b', { email: 'b@example.com', name: 'B' })
  assert.notStrictEqual(a, b)
})

process.env.SESSION_JWT_SECRET = 'test-secret-value-not-used-in-prod'

test('signSession + verifySession round-trip', () => {
  const token = signSession('u_abc123')
  assert.strictEqual(verifySession(token), 'u_abc123')
})

test('verifySession returns null for a tampered token', () => {
  const token = signSession('u_abc123')
  assert.strictEqual(verifySession(token + 'x'), null)
})

test('verifySession returns null when SESSION_JWT_SECRET is missing', () => {
  const saved = process.env.SESSION_JWT_SECRET
  delete process.env.SESSION_JWT_SECRET
  assert.strictEqual(verifySession('anything'), null)
  process.env.SESSION_JWT_SECRET = saved
})

test('verifySession returns null for an empty token', () => {
  assert.strictEqual(verifySession(''), null)
  assert.strictEqual(verifySession(undefined), null)
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && node --test googleAuth.test.js`
Expected: FAIL — `Cannot find module './googleAuth'`(파일이 아직 없음)

- [ ] **Step 3: `server/googleAuth.js` 최소 구현 작성**

```js
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const jwt = require('jsonwebtoken')
const { OAuth2Client } = require('google-auth-library')

const DATA_DIR = path.join(__dirname, 'data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

// 순수 함수: db 객체를 직접 받아 googleSub → userId를 조회/생성한다.
// 파일 I/O와 분리해둬서 유닛 테스트에서 실제 users.json 없이 검증할 수 있다.
function resolveUserId(db, googleSub, { email, name } = {}) {
  if (!db[googleSub]) {
    db[googleSub] = { userId: `u_${crypto.randomUUID()}`, email, name, createdAt: Date.now() }
  } else {
    if (email) db[googleSub].email = email
    if (name) db[googleSub].name = name
  }
  return db[googleSub].userId
}

let usersDb = {}
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(USERS_FILE)) usersDb = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
} catch { usersDb = {} }

function saveUsers() {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2)) } catch {}
}

function getOrCreateUserId(googleSub, profile) {
  const userId = resolveUserId(usersDb, googleSub, profile)
  saveUsers()
  return userId
}

function signSession(userId) {
  const secret = process.env.SESSION_JWT_SECRET
  if (!secret) throw new Error('SESSION_JWT_SECRET이 설정되지 않았습니다.')
  return jwt.sign({ userId }, secret, { expiresIn: '30d' })
}

// 유효하지 않거나 만료된 토큰이면 null을 반환한다(throw하지 않음 — 호출부가 게스트로 취급하기 쉽도록)
function verifySession(token) {
  const secret = process.env.SESSION_JWT_SECRET
  if (!secret || !token) return null
  try {
    return jwt.verify(token, secret).userId
  } catch {
    return null
  }
}

let oauthClient = null
function getOAuthClient() {
  if (!oauthClient) oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  return oauthClient
}

// Google ID 토큰(credential)을 검증해 { sub, email, name }을 반환한다.
// 검증 실패(서명/audience 불일치, 만료 등) 시 throw — 호출부(라우트)가 catch해서 401 처리
async function verifyGoogleIdToken(credential) {
  const client = getOAuthClient()
  const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID })
  const payload = ticket.getPayload()
  return { sub: payload.sub, email: payload.email, name: payload.name }
}

module.exports = { resolveUserId, getOrCreateUserId, signSession, verifySession, verifyGoogleIdToken }
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && node --test googleAuth.test.js`
Expected: PASS — 8개 테스트 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add server/googleAuth.js server/googleAuth.test.js
git commit -m "feat: googleSub-userId 매핑 + 세션 JWT 발급/검증 모듈 추가"
```

---

### Task 3: `server/index.js` — CORS/쿠키 미들웨어 + 인증 REST 라우트

**Files:**
- Modify: `server/index.js:1-11` (require문, app 설정)

**Interfaces:**
- Consumes: Task 2의 `getOrCreateUserId`, `signSession`, `verifySession`, `verifyGoogleIdToken`; 기존 `getProfile`(`server/ratings.js`, 이미 import됨)
- Produces: `POST /api/auth/google`, `GET /api/auth/me`, `POST /api/auth/logout` 라우트. `SESSION_COOKIE`(쿠키 이름) 상수와 `COOKIE_OPTIONS`를 Task 4(소켓 미들웨어)가 재사용

- [ ] **Step 1: 파일 상단 require/미들웨어 교체**

`server/index.js` 1~11행을 다음으로 교체:

```js
require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { createBoard, checkWin, isBoardFull } = require('./gameLogic')
const { checkForbidden } = require('./forbidden')
const { getProfile, applyResult, getLeaderboard } = require('./ratings')
const { getOrCreateUserId, signSession, verifySession, verifyGoogleIdToken } = require('./googleAuth')

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000'
const SESSION_COOKIE = 'omok_session'
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
}

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(cookieParser())
app.use(express.json())
```

- [ ] **Step 2: 인증 REST 라우트 추가**

`app.get('/api/leaderboard', ...)` 블록(기존 30~32행) 바로 다음에 추가:

```js
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body
    if (!credential) return res.status(400).json({ message: 'credential이 필요합니다.' })
    const { sub, email, name } = await verifyGoogleIdToken(credential)
    const userId = getOrCreateUserId(sub, { email, name })
    const token = signSession(userId)
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTIONS)
    res.json(getProfile(userId, name))
  } catch (err) {
    console.error('Google 로그인 실패:', err.message)
    res.status(401).json({ message: '로그인에 실패했습니다.' })
  }
})

app.get('/api/auth/me', (req, res) => {
  const userId = verifySession(req.cookies[SESSION_COOKIE])
  if (!userId) return res.json(null)
  res.json(getProfile(userId))
})

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS)
  res.json({ ok: true })
})
```

- [ ] **Step 3: `io` 생성부의 CORS도 동일하게 수정**

기존:
```js
const io = new Server(server, { cors: { origin: '*' } })
```
교체:
```js
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN, credentials: true } })
```

- [ ] **Step 4: 문법 확인**

Run: `node --check server/index.js`
Expected: 출력 없음(에러 없이 통과)

- [ ] **Step 5: 수동 기동 확인**

Run: `cd server && GOOGLE_CLIENT_ID=dummy SESSION_JWT_SECRET=dummy-secret node index.js` (백그라운드 또는 별도 터미널)
그 다음 다른 터미널에서:
Run: `curl -i http://localhost:4000/api/auth/me`
Expected: `200 OK`, 바디 `null`(로그인 안 한 상태이므로)

서버 프로세스 종료(Ctrl+C 또는 `kill`)

- [ ] **Step 6: 커밋**

```bash
git add server/index.js
git commit -m "feat: 서버에 Google 로그인 REST 라우트(auth/google·me·logout) + CORS 자격증명 설정 추가"
```

---

### Task 4: `server/index.js` — 소켓 인증 미들웨어 + 랭킹전 로그인 게이트

**Files:**
- Modify: `server/index.js` (`io.on('connection', ...)` 진입부, 랭킹 핸들러 에러 메시지 2곳)

**Interfaces:**
- Consumes: Task 2의 `verifySession`, Task 3의 `SESSION_COOKIE`
- Produces: `socket.data.userId` — 이후 커넥션 핸들러 전체가 `socket.handshake.auth.userId` 대신 이 값을 신뢰

- [ ] **Step 1: `io.on('connection', ...)` 앞에 인증 미들웨어 추가**

`io.on('connection', (socket) => {` 바로 위에 추가:

```js
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || ''
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))
  const token = match ? decodeURIComponent(match[1]) : null
  socket.data.userId = verifySession(token)
  next()
})
```

- [ ] **Step 2: 커넥션 핸들러의 신뢰 출처 교체**

기존:
```js
io.on('connection', (socket) => {
  const { userId } = socket.handshake.auth
  console.log('connected:', socket.id)
```
교체:
```js
io.on('connection', (socket) => {
  const userId = socket.data.userId
  console.log('connected:', socket.id)
```

(이 아래 `room:create`/`room:join`/`ranked:*`/`profile:get` 핸들러들은 전부 클로저로 이 `userId`를 참조하므로 다른 수정 불필요)

- [ ] **Step 3: 랭킹 로그인 게이트 에러 메시지 갱신**

`ranked:queue:join` 핸들러(기존 191행 부근):
```js
if (!userId) { socket.emit('room:error', { message: '사용자 정보가 없습니다.' }); return }
```
교체:
```js
if (!userId) { socket.emit('room:error', { message: '로그인이 필요합니다.' }); return }
```

`ranked:join` 핸들러(기존 241행 부근)에도 동일하게 적용:
```js
if (!userId) { socket.emit('room:error', { message: '로그인이 필요합니다.' }); return }
```

- [ ] **Step 4: 문법 확인**

Run: `node --check server/index.js`
Expected: 출력 없음

- [ ] **Step 5: 위조된 userId가 더 이상 반영되지 않는지 수동 확인**

`server/index.js`를 4099 포트 사본으로 잠깐 띄워(기존 `todo.md`의 관전 모드 검증과 동일한 방식) 소켓 클라이언트로 `auth: { userId: 'fake-admin-id' }`를 실어 연결한 뒤 `profile:get`을 보내고, `profile:data`가 오지 않거나(비로그인 취급) 서버 로그상 `socket.data.userId`가 `null`로 찍히는지 확인. 확인 후 사본/프로세스 정리.

- [ ] **Step 6: 커밋**

```bash
git add server/index.js
git commit -m "feat: 소켓 인증을 클라이언트 자기신고 userId에서 쿠키 검증 기반으로 전환"
```

---

### Task 5: `client/src/utils/guestNickname.js` (TDD)

**Files:**
- Create: `client/src/utils/guestNickname.js`
- Test: `client/src/utils/guestNickname.test.js`

**Interfaces:**
- Produces: `generateNickname() → string`(순수, 랜덤), `getGuestNickname() → string`(sessionStorage 캐싱 래퍼) — Task 8(Lobby.jsx)이 `getGuestNickname`을 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/utils/guestNickname.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateNickname } from './guestNickname.js'

test('generateNickname returns a non-empty string', () => {
  const name = generateNickname()
  assert.ok(typeof name === 'string' && name.length > 0)
})

test('generateNickname produces varied results over many calls', () => {
  const results = new Set()
  for (let i = 0; i < 50; i++) results.add(generateNickname())
  assert.ok(results.size > 1, `50번 호출했는데 전부 같은 닉네임이 나옴: ${[...results]}`)
})
```

(`getGuestNickname`은 `sessionStorage`에 의존해 Node 테스트 환경에서 안정적으로 재현하기 어려우므로 자동 테스트 대상에서 제외 — Task 9에서 브라우저로 수동 확인)

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd client && node --test src/utils/guestNickname.test.js`
Expected: FAIL — `Cannot find module './guestNickname.js'`

- [ ] **Step 3: 구현 작성**

`client/src/utils/guestNickname.js`:

```js
const ADJECTIVES = ['조용한', '빠른', '용감한', '느긋한', '영리한', '든든한', '유쾌한', '차분한']
const NOUNS = ['너구리', '사자', '고양이', '까치', '다람쥐', '수달', '여우', '부엉이']
const STORAGE_KEY = 'omok_guest_nickname'

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

export function generateNickname() {
  return `${randomPick(ADJECTIVES)}${randomPick(NOUNS)}`
}

// 같은 브라우저 탭 세션 동안은 같은 닉네임을 유지하고(재입장/재연결해도 안 바뀌게),
// 새 탭/새 세션이면 다시 생성한다 — 게스트에게 영속적 정체성을 주지 않기 위해 sessionStorage 사용
export function getGuestNickname() {
  let nickname = sessionStorage.getItem(STORAGE_KEY)
  if (!nickname) {
    nickname = generateNickname()
    sessionStorage.setItem(STORAGE_KEY, nickname)
  }
  return nickname
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd client && node --test src/utils/guestNickname.test.js`
Expected: PASS — 2개 테스트 통과

- [ ] **Step 5: 커밋**

```bash
git add client/src/utils/guestNickname.js client/src/utils/guestNickname.test.js
git commit -m "feat: 게스트용 랜덤 두 단어 닉네임 생성 유틸 추가"
```

---

### Task 6: `client/src/utils/auth.js` — GIS 로그인 연동

**Files:**
- Create: `client/src/utils/auth.js`

**Interfaces:**
- Consumes: `import.meta.env.VITE_GOOGLE_CLIENT_ID`(Task 1), 서버의 `/api/auth/google`·`/api/auth/me`·`/api/auth/logout`(Task 3)
- Produces: `renderGoogleButton(containerId, onCredential)`, `loginWithGoogle(credential) → Promise<profile>`, `fetchMe() → Promise<profile|null>`, `logout() → Promise<void>` — Task 8(App.jsx)·Task 9(Lobby.jsx)이 사용

이 파일은 브라우저 전역(`window.google`, `fetch`, `document`)에 의존해 Node 유닛 테스트로 재현하기 어렵다 — 프로젝트의 기존 관례(`aiWorker.js`, `Board.jsx` 등 브라우저 전용 코드도 자동 테스트 없이 수동 브라우저 검증만 함)를 따라 구현 후 Task 9에서 수동 검증한다.

- [ ] **Step 1: 구현 작성**

`client/src/utils/auth.js`:

```js
const GIS_SRC = 'https://accounts.google.com/gsi/client'

let scriptPromise = null
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  return scriptPromise
}

// containerId 엘리먼트 안에 Google 로그인 버튼을 렌더링한다.
// 로그인 성공 시 onCredential(idTokenString)이 호출된다.
export async function renderGoogleButton(containerId, onCredential) {
  await loadGoogleScript()
  window.google.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  })
  window.google.accounts.id.renderButton(
    document.getElementById(containerId),
    { theme: 'outline', size: 'large', text: 'signin_with' }
  )
}

export async function loginWithGoogle(credential) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential }),
  })
  if (!res.ok) throw new Error('로그인에 실패했습니다.')
  return res.json()
}

export async function fetchMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd client && npx vite build`
Expected: 에러 없이 빌드 성공(이 시점엔 아직 아무 컴포넌트도 `auth.js`를 import하지 않으므로 트리셰이킹으로 빠질 수 있음 — 문법 오류만 없으면 됨)

- [ ] **Step 3: 커밋**

```bash
git add client/src/utils/auth.js
git commit -m "feat: Google Identity Services 로그인 연동 유틸 추가"
```

---

### Task 7: `client/src/App.jsx` — 인증 상태 플러밍 + `userId.js` 제거

**Files:**
- Modify: `client/src/App.jsx`
- Delete: `client/src/utils/userId.js`

**Interfaces:**
- Consumes: Task 6의 `fetchMe`
- Produces: `me`(로그인 프로필 또는 `null`), `onAuthChange`(setter) — Task 9(Lobby.jsx)가 props로 받음. `Game`은 더 이상 `userId` prop을 받지 않음(Task 8에서 소켓이 쿠키로 자동 인증되므로)

- [ ] **Step 1: `App.jsx` 전체 교체**

```jsx
import { useState, useEffect } from 'react'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Leaderboard from './pages/Leaderboard'
import { fetchMe } from './utils/auth'
import './App.css'

function App() {
  const [page, setPage] = useState('lobby')
  const [gameConfig, setGameConfig] = useState(null)
  const [me, setMe] = useState(null)

  useEffect(() => { fetchMe().then(setMe) }, [])

  const goToGame = (config) => { setGameConfig(config); setPage('game') }
  const goToLobby = () => { setGameConfig(null); setPage('lobby') }

  return (
    <div className="app">
      {page === 'lobby' && (
        <Lobby
          me={me}
          onAuthChange={setMe}
          onStart={goToGame}
          onLeaderboard={() => setPage('leaderboard')}
        />
      )}
      {page === 'game' && (
        <Game config={gameConfig} onLeave={goToLobby} />
      )}
      {page === 'leaderboard' && (
        <Leaderboard onBack={goToLobby} />
      )}
    </div>
  )
}

export default App
```

- [ ] **Step 2: `client/src/utils/userId.js` 삭제**

Run: `rm client/src/utils/userId.js` (Windows PowerShell이면 `Remove-Item client/src/utils/userId.js`)

- [ ] **Step 3: 빌드 확인**

Run: `cd client && npx vite build`
Expected: 에러 없이 빌드 성공 — JS라 prop 타입 체크가 없어서 `Lobby.jsx`/`Game.jsx`가 아직 `userId` prop을 참조해도 컴파일 자체는 깨지지 않는다(런타임에 `userId`가 `undefined`로 들어갈 뿐). 이 두 파일의 실제 동작 정합은 Task 8·9에서 마저 맞춘다

- [ ] **Step 4: 커밋**

```bash
git add client/src/App.jsx
git rm client/src/utils/userId.js
git commit -m "refactor: App.jsx가 localStorage UUID 대신 서버 세션(/api/auth/me) 기준으로 인증 상태를 관리하도록 전환"
```

---

### Task 8: `client/src/pages/Game.jsx` — 소켓 쿠키 인증으로 전환

**Files:**
- Modify: `client/src/pages/Game.jsx:15`, `client/src/pages/Game.jsx:55`

**Interfaces:**
- Consumes: 없음(서버가 쿠키로 자동 인증)
- Produces: `Game` 컴포넌트가 `userId` prop 없이 동작

- [ ] **Step 1: 컴포넌트 시그니처에서 `userId` prop 제거**

`client/src/pages/Game.jsx:15`:

기존:
```js
export default function Game({ config, userId, onLeave }) {
```
교체:
```js
export default function Game({ config, onLeave }) {
```

- [ ] **Step 2: 소켓 연결 옵션 교체**

`client/src/pages/Game.jsx:55`:

기존:
```js
const socket = io('/', { path: '/socket.io', auth: { userId } })
```
교체:
```js
const socket = io('/', { path: '/socket.io', withCredentials: true })
```

- [ ] **Step 3: 빌드 확인**

Run: `cd client && npx vite build`
Expected: 에러 없이 빌드 성공(이 시점엔 `App.jsx`가 이미 `userId` prop을 안 넘기므로 정상)

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/Game.jsx
git commit -m "refactor: Game.jsx 소켓 연결을 자기신고 userId 대신 쿠키 기반 인증(withCredentials)으로 전환"
```

---

### Task 9: `client/src/pages/Lobby.jsx` — 로그인 UI + 게스트 닉네임 + 랭킹전 게이트

**Files:**
- Modify: `client/src/pages/Lobby.jsx` (전체)

**Interfaces:**
- Consumes: Task 5의 `getGuestNickname`, Task 6의 `renderGoogleButton`/`loginWithGoogle`/`logout`, `me`/`onAuthChange` props(Task 7)
- Produces: 방 생성/입장/랭킹전 어디서든 닉네임은 `me?.nickname ?? getGuestNickname()`

- [ ] **Step 1: 자유 입력 닉네임을 제거하고 로그인 상태 기반 닉네임/로그인 UI로 교체**

`client/src/pages/Lobby.jsx` 전체를 다음으로 교체:

```jsx
import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { getGuestNickname } from '../utils/guestNickname'
import { renderGoogleButton, loginWithGoogle, logout as logoutRequest } from '../utils/auth'
import styles from './Lobby.module.css'

export default function Lobby({ me, onAuthChange, onStart, onLeaderboard }) {
  const [tab, setTab] = useState('public')   // public | ranked
  const [publicRooms, setPublicRooms] = useState([])
  const [myProfile, setMyProfile] = useState(null)
  const [inQueue, setInQueue] = useState(false)
  const socketRef = useRef(null)

  const nick = me?.nickname || getGuestNickname()

  // 비로그인 상태면 Google 로그인 버튼을 렌더링
  useEffect(() => {
    if (me) return
    renderGoogleButton('google-signin-button', async (credential) => {
      try {
        const profile = await loginWithGoogle(credential)
        onAuthChange(profile)
      } catch {
        alert('로그인에 실패했습니다.')
      }
    })
  }, [me])

  async function handleLogout() {
    await logoutRequest()
    onAuthChange(null)
  }

  // 공개방 목록 2초마다 폴링
  useEffect(() => {
    if (tab !== 'public') return
    const fetchRooms = async () => {
      try {
        const res = await fetch('/api/rooms')
        setPublicRooms(await res.json())
      } catch {}
    }
    fetchRooms()
    const iv = setInterval(fetchRooms, 2000)
    return () => clearInterval(iv)
  }, [tab])

  // 랭킹전 탭: 로그인 상태일 때만 소켓 연결 + 프로필 로드
  useEffect(() => {
    if (tab !== 'ranked' || !me) return

    const socket = io('/', { path: '/socket.io', withCredentials: true })
    socketRef.current = socket

    socket.on('connect', () => socket.emit('profile:get'))
    socket.on('profile:data', setMyProfile)
    socket.on('ranked:queue:status', () => setInQueue(true))
    socket.on('ranked:match:found', ({ roomId }) => {
      setInQueue(false)
      socket.disconnect()
      socketRef.current = null
      onStart({ mode: 'online', action: 'ranked_join', roomCode: roomId, nickname: nick })
    })
    socket.on('room:error', ({ message }) => {
      alert(message)
      setInQueue(false)
    })

    return () => {
      socket.emit('ranked:queue:leave')
      socket.disconnect()
      socketRef.current = null
      setInQueue(false)
    }
  }, [tab, me]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleJoinQueue() {
    socketRef.current?.emit('ranked:queue:join', { nickname: nick })
    setInQueue(true)
  }

  function handleLeaveQueue() {
    socketRef.current?.emit('ranked:queue:leave')
    setInQueue(false)
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* 로고 */}
        <div className={styles.logo}>
          <div className={styles.stones}>
            <div className={styles.stoneB} />
            <div className={styles.stoneW} />
            <div className={styles.stoneB} />
          </div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>오목</h1>
            <button className={styles.rankBtn} onClick={onLeaderboard}>순위표</button>
          </div>
          <p className={styles.subtitle}>온라인 오목 · 렌주룰</p>
        </div>

        {/* 로그인 상태 */}
        <div className={styles.nicknameRow}>
          {me ? (
            <div className={styles.authRow}>
              <span>{me.nickname}님</span>
              <button className={`${styles.btn} ${styles.btnSmall}`} onClick={handleLogout}>로그아웃</button>
            </div>
          ) : (
            <div className={styles.authRow}>
              <span>게스트: {nick}</span>
              <div id="google-signin-button" />
            </div>
          )}
        </div>

        {/* 탭 */}
        <div className={styles.tabs}>
          {[
            { key: 'public',  label: '공개방' },
            { key: 'ranked',  label: '랭킹전' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 공개방 */}
        {tab === 'public' && (
          <div className={styles.panel}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => onStart({ mode: 'online', action: 'create', nickname: nick, type: 'public' })}
            >
              공개방 만들기
            </button>
            <div className={styles.roomList}>
              {publicRooms.length === 0 ? (
                <div className={styles.emptyRooms}>공개방이 없습니다</div>
              ) : (
                publicRooms.map(room => {
                  const isFull = room.playerCount >= 2
                  return (
                    <div key={room.roomId} className={styles.roomItem}>
                      <div className={styles.roomInfo}>
                        <span className={styles.roomHost}>{room.host}</span>
                        <span className={styles.roomCount}>{room.playerCount}/2</span>
                      </div>
                      <button
                        className={`${styles.btn} ${styles.btnSmall}`}
                        onClick={() => onStart({
                          mode: 'online',
                          action: isFull ? 'spectate' : 'join',
                          roomCode: room.roomId,
                          nickname: nick,
                        })}
                      >
                        {isFull ? '관전' : '입장'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* 랭킹전 */}
        {tab === 'ranked' && (
          <div className={styles.panel}>
            {!me ? (
              <div className={styles.emptyRooms}>랭킹전은 로그인이 필요합니다.</div>
            ) : (
              <>
                {myProfile && (
                  <div className={styles.profileBox}>
                    <div className={styles.ratingLabel}>내 레이팅 (ELO)</div>
                    <div className={styles.ratingValue}>{myProfile.rating}</div>
                    <div className={styles.recordRow}>
                      <span className={styles.win}>{myProfile.wins}승</span>
                      <span className={styles.lose}>{myProfile.losses}패</span>
                      {myProfile.draws > 0 && <span className={styles.draw}>{myProfile.draws}무</span>}
                    </div>
                  </div>
                )}
                {!inQueue ? (
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleJoinQueue}>
                    대기열 참가
                  </button>
                ) : (
                  <div className={styles.queueBox}>
                    <div className={styles.queueSpinner} />
                    <p className={styles.queueText}>상대를 찾는 중...</p>
                    <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleLeaveQueue}>
                      취소
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* AI 대전 (항상 하단 고정) — 흑/백 선택 */}
        <div className={styles.aiColorRow}>
          <button
            className={`${styles.btn} ${styles.btnAI}`}
            onClick={() => onStart({ mode: 'ai', nickname: nick, humanColor: 'black' })}
          >
            AI 대전 (흑으로 시작)
          </button>
          <button
            className={`${styles.btn} ${styles.btnAI}`}
            onClick={() => onStart({ mode: 'ai', nickname: nick, humanColor: 'white' })}
          >
            AI 대전 (백으로 시작)
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `.authRow` CSS 클래스 추가**

`client/src/pages/Lobby.module.css`에 다음을 추가(기존 `.nicknameRow` 규칙 근처):

```css
.authRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
```

(기존 `.nicknameRow`가 이미 flex/gap을 잡아주는 컨테이너라면 이 규칙은 그 안의 좌우 배치만 담당 — 실제 파일을 열어 기존 스타일과 시각적으로 어색하지 않은지 확인하고 필요시 조정)

- [ ] **Step 3: 빌드 확인**

Run: `cd client && npx vite build`
Expected: 에러 없이 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/Lobby.jsx client/src/pages/Lobby.module.css
git commit -m "feat: 로비에 Google 로그인/로그아웃 UI 추가, 게스트 자유입력 닉네임을 자동 생성 닉네임으로 교체, 랭킹전 탭 로그인 게이트 추가"
```

---

### Task 10: 수동 엔드투엔드 검증 + 문서 갱신

**Files:**
- Modify: `CLAUDE.md`, `docs/PRD.md`

**Interfaces:**
- 없음(검증 + 문서화 태스크)

- [ ] **Step 1: 실제 Google OAuth Client ID 발급**

[Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 OAuth 2.0 Client ID(유형: 웹 애플리케이션)를 생성한다. 승인된 자바스크립트 원본에 `http://localhost:3000`을 추가한다. 발급받은 Client ID를 `server/.env`(`GOOGLE_CLIENT_ID`, `SESSION_JWT_SECRET`은 임의의 긴 랜덤 문자열)와 `client/.env`(`VITE_GOOGLE_CLIENT_ID`)에 각각 채운다. *(이 단계는 사용자의 Google 계정 작업이 필요 — 값을 발급받아 알려주면 이어서 진행)*

- [ ] **Step 2: 서버·클라이언트 동시 실행**

Run: `npm run dev` (루트에서)
Expected: 클라이언트 `http://localhost:3000`, 서버 `http://localhost:4000` 정상 기동

- [ ] **Step 3: 로그인 플로우 수동 확인**

브라우저에서 `http://localhost:3000` 접속 → "Google로 로그인" 버튼으로 로그인 → 로비 상단에 "{이름}님" + 로그아웃 버튼 표시 확인 → 브라우저 개발자도구 Application 탭에서 `omok_session` httpOnly 쿠키가 심어졌는지 확인 → 페이지 새로고침 후에도 로그인 상태가 유지되는지 확인(`/api/auth/me`가 프로필을 반환하는지)

- [ ] **Step 4: 로그아웃 확인**

로그아웃 버튼 클릭 → 쿠키 삭제됨(개발자도구로 확인) → 로비가 게스트 상태(랜덤 닉네임 + 로그인 버튼)로 돌아가는지 확인

- [ ] **Step 5: 게스트 제한 확인**

로그아웃 상태에서 공개방 생성 → 정상 동작 확인. AI 대전(흑/백 둘 다) → 정상 동작 확인(회귀 없음). 랭킹전 탭 클릭 → "로그인이 필요합니다" 메시지만 뜨고 대기열 참가 버튼이 없는지 확인

- [ ] **Step 6: 로그인 후 랭킹전 확인**

로그인 상태에서 랭킹전 대기열 참가 → 두 번째 브라우저(시크릿 창 등)로 다른 Google 계정(또는 동일 계정 두 탭 — 매칭 로직상 한 계정끼리는 큐에서 자동 병합되므로, 가능하면 다른 계정 두 개로 테스트)으로 매칭 → 게임 진행 → 종료 후 레이팅 갱신 확인. 로그아웃 후 다시 로그인해 레이팅이 유지되는지 확인(기기/브라우저를 바꿔도 유지되는지까지 확인할 수 있으면 더 좋음)

- [ ] **Step 7: userId 스푸핑 방지 확인**

브라우저 개발자도구 콘솔에서 소켓 핸드셰이크에 임의의 `auth.userId`를 실어 보내도(예: 브라우저 콘솔에서 새 `io()` 인스턴스를 `auth:{userId:'fake'}`로 직접 생성해 `profile:get` 전송) 서버가 실제 로그인 세션과 무관한 프로필을 반환하지 않는지 확인(쿠키 미검증 경로가 남아있지 않은지 최종 확인)

- [ ] **Step 8: `CLAUDE.md` 갱신**

`CLAUDE.md`의 "주요 파일" 표에 `server/googleAuth.js`, `client/src/utils/auth.js`, `client/src/utils/guestNickname.js` 추가하고 `client/src/utils/userId.js` 행 제거. "Socket.io 이벤트 요약"의 인증 방식 설명(있다면)과 "알려진 제약/주의사항"에 "인증은 httpOnly 쿠키 기반 세션(Google 로그인), 게스트는 공개방/AI 대전만 가능" 한 줄 추가.

- [ ] **Step 9: `docs/PRD.md` 갱신**

4절 "미구현/향후 과제" 표에서 "회원가입/로그인" 행을 제거하고, 3.1절(로비) 표에 "Google 로그인 / 게스트 제한" 행을 완료 상태로 추가.

- [ ] **Step 10: 최종 빌드 확인 + 커밋**

Run: `cd client && npx vite build && npx oxlint`
Run: `node --check server/index.js && node --check server/googleAuth.js`
Run: `cd server && node --test *.test.js && cd ../client && node --test src/utils/*.test.js`
Expected: 전부 에러 없이 통과

```bash
git add CLAUDE.md docs/PRD.md
git commit -m "docs: Google OAuth 인증 도입 반영(CLAUDE.md 주요 파일 표, PRD 완료 항목 갱신)"
```

- [ ] **Step 11: `docs/todo.md`에 완료 기록**

`docs/todo.md`의 "계정/로그인 시스템" 체크박스를 `[x]`로 바꾸고 완료 날짜·간단한 요약(검증 결과 포함)을 추가.

```bash
git add docs/todo.md
git commit -m "docs: Google OAuth 인증 구현 완료 기록"
```
