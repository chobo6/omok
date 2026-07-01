const BOARD_SIZE = 15

// 방향 벡터
const DIRECTIONS = [
  [0, 1], [1, 0], [1, 1], [1, -1]
]

function countLine(board, row, col, dr, dc, player) {
  let count = 0
  let open = 0

  for (let d = 1; d <= 4; d++) {
    const r = row + dr * d
    const c = col + dc * d
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
    if (board[r][c] === player) count++
    else {
      if (board[r][c] === 0) open++
      break
    }
  }
  for (let d = 1; d <= 4; d++) {
    const r = row - dr * d
    const c = col - dc * d
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
    if (board[r][c] === player) count++
    else {
      if (board[r][c] === 0) open++
      break
    }
  }

  return { count: count + 1, open }
}

function scoreCell(board, row, col, player) {
  let score = 0
  const opp = player === 1 ? 2 : 1

  for (const [dr, dc] of DIRECTIONS) {
    const mine = countLine(board, row, col, dr, dc, player)
    const enemy = countLine(board, row, col, dr, dc, opp)

    if (mine.count >= 5) score += 100000
    else if (mine.count === 4 && mine.open >= 1) score += 10000
    else if (mine.count === 3 && mine.open === 2) score += 1000
    else if (mine.count === 3 && mine.open === 1) score += 100
    else if (mine.count === 2 && mine.open === 2) score += 10

    if (enemy.count >= 5) score += 50000
    else if (enemy.count === 4 && enemy.open >= 1) score += 8000
    else if (enemy.count === 3 && enemy.open === 2) score += 500
  }

  return score
}

function getCandidates(board) {
  const candidates = new Set()
  const range = 2

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) continue
      for (let dr = -range; dr <= range; dr++) {
        for (let dc = -range; dc <= range; dc++) {
          const nr = r + dr
          const nc = c + dc
          if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === 0) {
            candidates.add(`${nr},${nc}`)
          }
        }
      }
    }
  }

  if (candidates.size === 0) {
    candidates.add(`${Math.floor(BOARD_SIZE / 2)},${Math.floor(BOARD_SIZE / 2)}`)
  }

  return [...candidates].map(s => {
    const [r, c] = s.split(',').map(Number)
    return { row: r, col: c }
  })
}

function checkWinBoard(board, row, col, player) {
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1
    for (let d = 1; d <= 4; d++) {
      const r = row + dr * d, c = col + dc * d
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break
      count++
    }
    for (let d = 1; d <= 4; d++) {
      const r = row - dr * d, c = col - dc * d
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break
      count++
    }
    if (count >= 5) return true
  }
  return false
}

function minimax(board, depth, alpha, beta, isMaximizing, aiPlayer) {
  const humanPlayer = aiPlayer === 1 ? 2 : 1

  if (depth === 0) {
    let score = 0
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === aiPlayer) score += scoreCell(board, r, c, aiPlayer)
        else if (board[r][c] === humanPlayer) score -= scoreCell(board, r, c, humanPlayer)
      }
    }
    return score
  }

  const candidates = getCandidates(board)

  if (isMaximizing) {
    let best = -Infinity
    for (const { row, col } of candidates) {
      board[row][col] = aiPlayer
      if (checkWinBoard(board, row, col, aiPlayer)) {
        board[row][col] = 0
        return 100000 * (depth + 1)
      }
      const val = minimax(board, depth - 1, alpha, beta, false, aiPlayer)
      board[row][col] = 0
      best = Math.max(best, val)
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const { row, col } of candidates) {
      board[row][col] = humanPlayer
      if (checkWinBoard(board, row, col, humanPlayer)) {
        board[row][col] = 0
        return -100000 * (depth + 1)
      }
      const val = minimax(board, depth - 1, alpha, beta, true, aiPlayer)
      board[row][col] = 0
      best = Math.min(best, val)
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }
}

export function getAIMove(board, aiPlayer) {
  const candidates = getCandidates(board)
  let bestScore = -Infinity
  let bestMove = candidates[0]

  // 빠른 승리/패배 방어 체크
  for (const { row, col } of candidates) {
    board[row][col] = aiPlayer
    if (checkWinBoard(board, row, col, aiPlayer)) {
      board[row][col] = 0
      return { row, col }
    }
    board[row][col] = 0
  }

  const humanPlayer = aiPlayer === 1 ? 2 : 1
  for (const { row, col } of candidates) {
    board[row][col] = humanPlayer
    if (checkWinBoard(board, row, col, humanPlayer)) {
      board[row][col] = 0
      return { row, col }
    }
    board[row][col] = 0
  }

  // Minimax depth=3
  const sortedCandidates = candidates
    .map(c => ({ ...c, heuristic: scoreCell(board, c.row, c.col, aiPlayer) }))
    .sort((a, b) => b.heuristic - a.heuristic)
    .slice(0, 20)

  for (const { row, col } of sortedCandidates) {
    board[row][col] = aiPlayer
    const score = minimax(board, 3, -Infinity, Infinity, false, aiPlayer)
    board[row][col] = 0

    if (score > bestScore) {
      bestScore = score
      bestMove = { row, col }
    }
  }

  return bestMove
}
