const jwt = require('jsonwebtoken')
const { OAuth2Client } = require('google-auth-library')
const pool = require('./db/pool')

// googleSub 기준 upsert — UNIQUE(google_sub) + ON CONFLICT로 존재 확인/생성/갱신을 원자적으로 처리.
// 처음 로그인한 사용자는 이 시점에 users 행이 생성되므로(닉네임은 테이블 기본값 '플레이어'),
// 이후 getProfile(server/ratings.js)은 행이 항상 존재한다고 가정해도 된다.
async function getOrCreateUserId(googleSub, { email, name } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, users.email),
           name = COALESCE(EXCLUDED.name, users.name)
     RETURNING id`,
    [googleSub, email, name]
  )
  return rows[0].id
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

module.exports = { getOrCreateUserId, signSession, verifySession, verifyGoogleIdToken }
