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

// 순수 함수: db 객체에서 userId로 googleSub→userId 매핑을 역탐색해 저장된 이름을 조회한다.
// ratings.json은 랭킹전 완료 시에만 저장되므로(server/ratings.js applyResult),
// 로그인은 했지만 아직 첫 게임을 안 한 사용자의 닉네임은 여기서 가져와야 최신값이 보장된다.
function resolveStoredName(db, userId) {
  const entry = Object.values(db).find(u => u.userId === userId)
  return entry?.name
}

function getStoredName(userId) {
  return resolveStoredName(usersDb, userId)
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

module.exports = { resolveUserId, getOrCreateUserId, resolveStoredName, getStoredName, signSession, verifySession, verifyGoogleIdToken }
