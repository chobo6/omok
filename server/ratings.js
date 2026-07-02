const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, 'data')
const FILE = path.join(DATA_DIR, 'ratings.json')
const DEFAULT_RATING = 1200
const K = 32

let db = {}
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch { db = {} }

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)) } catch {}
}

function getProfile(userId, nickname) {
  if (!db[userId]) {
    db[userId] = { rating: DEFAULT_RATING, wins: 0, losses: 0, draws: 0, nickname: nickname || '플레이어' }
  }
  if (nickname) db[userId].nickname = nickname
  return db[userId]
}

// ELO 계산: scoreFor 1=A승 / 0.5=무 / 0=A패
function calcElo(rA, rB, scoreFor) {
  const exp = 1 / (1 + 10 ** ((rB - rA) / 400))
  return {
    newA: Math.max(100, Math.round(rA + K * (scoreFor - exp))),
    newB: Math.max(100, Math.round(rB + K * ((1 - scoreFor) - (1 - exp)))),
  }
}

function applyResult(uidA, uidB, scoreFor) {
  const a = getProfile(uidA)
  const b = getProfile(uidB)
  const { newA, newB } = calcElo(a.rating, b.rating, scoreFor)
  const deltaA = newA - a.rating
  const deltaB = newB - b.rating
  a.rating = newA
  b.rating = newB
  if (scoreFor === 1)   { a.wins++; b.losses++ }
  else if (scoreFor === 0) { a.losses++; b.wins++ }
  else                  { a.draws++; b.draws++ }
  save()
  return { deltaA, deltaB, ratingA: newA, ratingB: newB }
}

function getLeaderboard(limit = 20) {
  return Object.entries(db)
    .map(([userId, p]) => ({ userId, ...p, games: p.wins + p.losses + p.draws }))
    .filter(p => p.games > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
}

module.exports = { getProfile, applyResult, getLeaderboard, DEFAULT_RATING }
