const BOARD_SIZE = 15

// 방향 벡터
const DIRECTIONS = [
  [0, 1], [1, 0], [1, 1], [1, -1]
]

const BLOCKED = -1 // 보드 밖은 상대 돌과 동일하게 "막힘"으로 취급

// (row,col) 중심으로 dr,dc 방향의 반경 4칸 (총 9칸) 라인을 추출
function buildLine(board, row, col, dr, dc) {
  const line = []
  for (let d = -4; d <= 4; d++) {
    const r = row + dr * d
    const c = col + dc * d
    line.push(r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE ? BLOCKED : board[r][c])
  }
  return line
}

// 9칸 라인 위에서 5칸짜리 창을 슬라이딩하며 위협을 탐지.
// 연속된 돌뿐 아니라 "XX.X", "X.XX" 같은 끊긴(gap) 패턴도 창 안의 개수만으로 동일하게 잡아낸다.
// 같은 모양이 몇 개의 창에서 동시에 성립하는지로 열린/막힌 여부를 근사한다
// (예: 열린사 .XXXX.는 서로 다른 두 창에서 각각 사(四)로 잡혀 fourWindows>=2가 됨).
function analyzeDirection(line, player) {
  let five = false
  let fourWindows = 0
  let threeWindows = 0
  let twoWindows = 0

  for (let start = 0; start <= 4; start++) {
    let mine = 0
    let empty = 0
    let blocked = false

    for (let i = start; i < start + 5; i++) {
      const v = line[i]
      if (v === player) mine++
      else if (v === 0) empty++
      else blocked = true
    }
    if (blocked) continue

    if (mine === 5) five = true
    else if (mine === 4 && empty === 1) fourWindows++
    else if (mine === 3 && empty === 2) threeWindows++
    else if (mine === 2 && empty === 3) twoWindows++
  }

  return { five, fourWindows, threeWindows, twoWindows }
}

function scoreCell(board, row, col, player) {
  let score = 0
  const opp = player === 1 ? 2 : 1

  for (const [dr, dc] of DIRECTIONS) {
    const line = buildLine(board, row, col, dr, dc)
    const mine = analyzeDirection(line, player)
    const enemy = analyzeDirection(line, opp)

    if (mine.five) score += 100000
    else if (mine.fourWindows >= 1) score += 10000
    else if (mine.threeWindows >= 2) score += 1000
    else if (mine.threeWindows === 1) score += 100
    else if (mine.twoWindows >= 2) score += 10

    if (enemy.five) score += 50000
    else if (enemy.fourWindows >= 1) score += 8000
    else if (enemy.threeWindows >= 2) score += 500
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

// 상대의 첫 수(항상 정중앙) 직후 AI의 응수를 다양화하기 위한 오프닝 로직.
// 보드에 돌이 정확히 1개면 그 돌 상하좌우/대각선 1칸 이내(3x3, 중심 제외) 중 랜덤으로 착수한다
function getOpeningMove(board) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) continue

      const neighbors = []
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r + dr
          const nc = c + dc
          if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === 0) {
            neighbors.push({ row: nr, col: nc })
          }
        }
      }
      return neighbors[Math.floor(Math.random() * neighbors.length)]
    }
  }
  return null
}

function countStones(board) {
  let n = 0
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== 0) n++
    }
  }
  return n
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

const VCF_MAX_DEPTH = 8 // 내 착수 기준 최대 4수 앞까지 강제 승리 수순 탐색

// player가 (row,col)에 착수했다고 가정하고, 그 수가 만드는 "사(四)"들의 완성 지점(빈 칸)을 모두 반환.
// 완성 지점이 2개 이상이면 상대가 둘 다 막을 수 없는 열린사(더블사) = 즉시 승리 확정
function getFourThreats(board, row, col, player) {
  const completions = []

  for (const [dr, dc] of DIRECTIONS) {
    const line = buildLine(board, row, col, dr, dc)

    for (let start = 0; start <= 4; start++) {
      let mine = 0
      let emptyIdx = -1
      let blocked = false

      for (let i = start; i < start + 5; i++) {
        const v = line[i]
        if (v === player) mine++
        else if (v === 0) emptyIdx = emptyIdx === -1 ? i : -2
        else blocked = true
      }
      if (blocked || mine !== 4 || emptyIdx < 0) continue

      const d = emptyIdx - 4
      completions.push({ row: row + dr * d, col: col + dc * d })
    }
  }

  const seen = new Set()
  return completions.filter(({ row: r, col: c }) => {
    const key = `${r},${c}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// 후보 수 중 "사(四)"를 만드는 수만 골라, 그 사를 막을 완성 지점과 함께 반환
function findFourMoves(board, player) {
  const moves = []
  for (const { row, col } of getCandidates(board)) {
    board[row][col] = player
    const completions = getFourThreats(board, row, col, player)
    board[row][col] = 0
    if (completions.length > 0) moves.push({ row, col, completions })
  }
  return moves
}

// VCF(Victory by Continuous Fours): 사(四)만 연속으로 만들어 상대를 강제로 방어시키며 오목을 완성하는 수순 탐색.
// 상대는 항상 유일한 완성 지점을 막는다고 가정 (상대의 반격 가능성은 고려하지 않는 단순화된 탐색)
function searchVCF(board, player, depth) {
  if (depth >= VCF_MAX_DEPTH) return null

  const opponent = player === 1 ? 2 : 1

  for (const { row, col, completions } of findFourMoves(board, player)) {
    board[row][col] = player

    const isWin = checkWinBoard(board, row, col, player) || completions.length >= 2

    if (isWin) {
      board[row][col] = 0
      return [{ row, col }]
    }

    const block = completions[0]
    board[block.row][block.col] = opponent
    const rest = searchVCF(board, player, depth + 2)
    board[block.row][block.col] = 0
    board[row][col] = 0

    if (rest) return [{ row, col }, ...rest]
  }

  return null
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
  // 오프닝: 상대가 첫 수만 둔 상태면 3x3 반경 내 랜덤 응수
  if (countStones(board) === 1) {
    const opening = getOpeningMove(board)
    if (opening) return opening
  }

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

  // VCF(연속사 강제 승리 수순) 탐색 - 있으면 그 수순의 첫 수를 바로 둔다
  const vcf = searchVCF(board, aiPlayer, 0)
  if (vcf) return vcf[0]

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
