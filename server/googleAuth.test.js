const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveUserId, resolveStoredName, signSession, verifySession } = require('./googleAuth')

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

test('resolveStoredName returns the stored name for an existing userId', () => {
  const db = {}
  const userId = resolveUserId(db, 'google-sub-name-1', { email: 'c@example.com', name: 'Charlie' })
  assert.strictEqual(resolveStoredName(db, userId), 'Charlie')
})

test('resolveStoredName returns undefined for a userId not present in the db', () => {
  const db = {}
  resolveUserId(db, 'google-sub-name-2', { email: 'd@example.com', name: 'Dana' })
  assert.strictEqual(resolveStoredName(db, 'u_does-not-exist'), undefined)
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
