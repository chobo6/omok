const pool = require('./db/pool')

const K = 32

// userId가 가리키는 users 행은 로그인 시점(googleAuth.js의 getOrCreateUserId)에 이미
// 생성돼 있다고 가정한다 — 이 함수는 존재 확인/생성을 다시 하지 않는다.
async function getProfile(userId, nickname) {
  if (nickname) {
    const { rows } = await pool.query(
      'UPDATE users SET nickname = $1 WHERE id = $2 RETURNING nickname, rating, wins, losses, draws',
      [nickname, userId]
    )
    return rows[0]
  }
  const { rows } = await pool.query(
    'SELECT nickname, rating, wins, losses, draws FROM users WHERE id = $1',
    [userId]
  )
  return rows[0]
}

// ELO 계산: scoreFor 1=A승 / 0.5=무 / 0=A패
function calcElo(rA, rB, scoreFor) {
  const exp = 1 / (1 + 10 ** ((rB - rA) / 400))
  return {
    newA: Math.max(100, Math.round(rA + K * (scoreFor - exp))),
    newB: Math.max(100, Math.round(rB + K * ((1 - scoreFor) - (1 - exp)))),
  }
}

async function applyResult(uidA, uidB, scoreFor) {
  if (uidA === uidB) throw new Error('applyResult: uidA와 uidB가 동일한 사용자입니다.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // FOR UPDATE로 두 행을 잠가 동시 게임 종료 경합 시 레이팅 계산이 서로를 덮어쓰지 않게 함
    const { rows } = await client.query(
      'SELECT id, rating FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [[uidA, uidB]]
    )
    const a = rows.find(r => r.id === uidA)
    const b = rows.find(r => r.id === uidB)
    const { newA, newB } = calcElo(a.rating, b.rating, scoreFor)
    const deltaA = newA - a.rating
    const deltaB = newB - b.rating

    const winsA = scoreFor === 1 ? 1 : 0
    const lossesA = scoreFor === 0 ? 1 : 0
    const drawsA = scoreFor === 0.5 ? 1 : 0

    await client.query(
      'UPDATE users SET rating = $1, wins = wins + $2, losses = losses + $3, draws = draws + $4 WHERE id = $5',
      [newA, winsA, lossesA, drawsA, uidA]
    )
    await client.query(
      'UPDATE users SET rating = $1, wins = wins + $2, losses = losses + $3, draws = draws + $4 WHERE id = $5',
      [newB, lossesA, winsA, drawsA, uidB]
    )
    await client.query('COMMIT')
    return { deltaA, deltaB, ratingA: newA, ratingB: newB }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function getLeaderboard(limit = 20) {
  const { rows } = await pool.query(
    `SELECT id AS "userId", nickname, rating, wins, losses, draws, (wins + losses + draws) AS games
     FROM users
     WHERE (wins + losses + draws) > 0
     ORDER BY rating DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

module.exports = { getProfile, applyResult, getLeaderboard, calcElo }
