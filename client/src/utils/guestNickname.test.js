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
