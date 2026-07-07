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
