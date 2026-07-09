const test = require('node:test')
const assert = require('node:assert/strict')
const { signSession, verifySession } = require('./googleAuth')

// getOrCreateUserId는 Postgres upsert(ON CONFLICT)로 구현돼 있어 순수 함수 단위 테스트로
// 분리할 수 없다 — 실제 동작 검증은 로컬 DB 대상 통합 테스트가 필요(아직 미구축, docs/DB_SCHEMA.md 참고).

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
