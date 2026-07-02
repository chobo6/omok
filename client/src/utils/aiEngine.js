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

// candidates 중 opponent가 두면 (a) 즉시 5목 승리하거나 (b) 완성 지점이 2곳 이상인
// 사(四, 열린사/더블사)를 만들어 다음 수에 한 곳만 막아선 못 막는 자리를 모두 반환.
// 즉시방어가 "막을 수 있는 곳 1곳"만 찾고 멈추면 열린사처럼 원천적으로 막을 수 없는
// 위협을 절반만 막고 나머지 절반을 방치하는 문제가 생기므로, 반드시 전부 모아야 함
function findCriticalDefenseCells(board, candidates, opponent) {
  const critical = []
  for (const { row, col } of candidates) {
    board[row][col] = opponent
    const wins = checkWinBoard(board, row, col, opponent)
    const fourThreats = wins ? [] : getFourThreats(board, row, col, opponent)
    board[row][col] = 0
    if (wins || fourThreats.length >= 2) critical.push({ row, col })
  }
  return critical
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

// ---- Zobrist 해싱 (Transposition Table 키 계산용) ----
// board[r][c] 값(1 또는 2)별로 서로 다른 난수를 배정해두고, 착수/취소마다
// 해당 칸의 난수를 XOR하면 매번 보드 전체를 스캔하지 않고도 해시를 증분 갱신할 수 있다.
function createZobristTable() {
  const table = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = []
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push([0, Math.floor(Math.random() * 0x7fffffff), Math.floor(Math.random() * 0x7fffffff)])
    }
    table.push(row)
  }
  return table
}
const ZOBRIST = createZobristTable()

function computeHash(board) {
  let hash = 0
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const v = board[r][c]
      if (v !== 0) hash ^= ZOBRIST[r][c][v]
    }
  }
  return hash
}

const WIN_SCORE = 1000000
const TT_EXACT = 0
const TT_LOWER = 1
const TT_UPPER = 2
const MAX_CANDIDATES_PER_NODE = 20
const TIME_BUDGET_MS = 2000
const MAX_SEARCH_DEPTH = 12

// side(1|2) 관점 평가. 양수면 side에게 유리
function evaluate(board, side) {
  const opponent = side === 1 ? 2 : 1
  let score = 0
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === side) score += scoreCell(board, r, c, side)
      else if (board[r][c] === opponent) score -= scoreCell(board, r, c, opponent)
    }
  }
  return score
}

// 후보를 매 노드마다 새로 채점·정렬. tt에 저장된 수(ttMove)가 있으면 최우선 탐색
// (트랜스포지션 테이블 적중 시 이전에 좋았던 수부터 보므로 알파베타 가지치기 효율이 오름)
function orderCandidates(board, candidates, side, ttMove) {
  return candidates
    .map(c => ({
      ...c,
      heuristic: (ttMove && c.row === ttMove.row && c.col === ttMove.col)
        ? Infinity
        : scoreCell(board, c.row, c.col, side),
    }))
    .sort((a, b) => b.heuristic - a.heuristic)
    .slice(0, MAX_CANDIDATES_PER_NODE)
}

// side 관점 negamax. 반환값이 양수면 side(지금 둘 차례)에게 유리.
// tt: 이번 getAIMove 호출 한 번 동안만 쓰는 Map 기반 Transposition Table
// deadline: Date.now() 기준 탐색 종료 시각 — 넘으면 그 지점에서 정적 평가로 대체
function negamax(board, depth, alpha, beta, side, hash, tt, deadline) {
  const alphaOrig = alpha
  const entry = tt.get(hash)
  if (entry && entry.depth >= depth) {
    if (entry.bound === TT_EXACT) return entry.value
    if (entry.bound === TT_LOWER) alpha = Math.max(alpha, entry.value)
    else if (entry.bound === TT_UPPER) beta = Math.min(beta, entry.value)
    if (alpha >= beta) return entry.value
  }

  if (depth === 0 || Date.now() > deadline) {
    return evaluate(board, side)
  }

  const opponent = side === 1 ? 2 : 1
  const candidates = orderCandidates(board, getCandidates(board), side, entry?.bestMove)

  let best = -Infinity
  let bestMove = null

  for (const { row, col } of candidates) {
    board[row][col] = side
    if (checkWinBoard(board, row, col, side)) {
      board[row][col] = 0
      const val = WIN_SCORE + depth
      tt.set(hash, { depth, value: val, bound: TT_EXACT, bestMove: { row, col } })
      return val
    }
    const childHash = hash ^ ZOBRIST[row][col][side]
    const val = -negamax(board, depth - 1, -beta, -alpha, opponent, childHash, tt, deadline)
    board[row][col] = 0

    if (val > best) { best = val; bestMove = { row, col } }
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }

  if (bestMove) {
    const bound = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
    tt.set(hash, { depth, value: best, bound, bestMove })
  }

  return best
}

// 루트에서 후보 하나씩 negamax(상대 관점)를 호출해 최선의 수를 찾는다.
// deadline을 넘기면 이번 depth는 미완료로 처리해 호출부가 이전 depth 결과를 유지하게 한다.
function rootSearch(board, candidates, depth, aiPlayer, hash, tt, deadline) {
  const opponent = aiPlayer === 1 ? 2 : 1
  const ordered = orderCandidates(board, candidates, aiPlayer, tt.get(hash)?.bestMove)

  let alpha = -Infinity
  let bestMove = null
  let bestScore = -Infinity

  for (const { row, col } of ordered) {
    board[row][col] = aiPlayer
    if (checkWinBoard(board, row, col, aiPlayer)) {
      board[row][col] = 0
      return { move: { row, col }, score: WIN_SCORE + depth, complete: true }
    }
    const childHash = hash ^ ZOBRIST[row][col][aiPlayer]
    const val = -negamax(board, depth - 1, -Infinity, -alpha, opponent, childHash, tt, deadline)
    board[row][col] = 0

    if (Date.now() > deadline) {
      return { move: bestMove, score: bestScore, complete: false }
    }

    if (val > bestScore) { bestScore = val; bestMove = { row, col } }
    if (bestScore > alpha) alpha = bestScore
  }

  if (bestMove) tt.set(hash, { depth, value: bestScore, bound: TT_EXACT, bestMove })
  return { move: bestMove, score: bestScore, complete: true }
}

// 반복심화(Iterative Deepening): 시간 예산 안에서 depth 1→2→3…로 점점 깊이 탐색하고,
// 끝까지 완료된 depth의 결과만 채택한다 (도중에 시간이 끝난 depth의 부분 결과는 버림).
// Transposition Table을 depth 사이에서 재사용해 얕은 depth에서 찾은 최선 수가
// 다음 depth의 탐색 순서를 앞당겨준다.
function iterativeDeepeningSearch(board, candidates, aiPlayer, timeBudgetMs) {
  const deadline = Date.now() + timeBudgetMs
  const tt = new Map()
  const rootHash = computeHash(board)

  let overallBest = candidates[0]
  for (let depth = 1; depth <= MAX_SEARCH_DEPTH; depth++) {
    if (Date.now() > deadline) break
    const result = rootSearch(board, candidates, depth, aiPlayer, rootHash, tt, deadline)
    if (!result.complete || !result.move) break
    overallBest = result.move
    if (result.score >= WIN_SCORE) break // 확정 승리 수순을 찾았으면 더 깊이 볼 필요 없음
  }
  return overallBest
}

export function getAIMove(board, aiPlayer) {
  // 오프닝: 상대가 첫 수만 둔 상태면 3x3 반경 내 랜덤 응수
  if (countStones(board) === 1) {
    const opening = getOpeningMove(board)
    if (opening) return opening
  }

  const candidates = getCandidates(board)

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
  const criticalCells = findCriticalDefenseCells(board, candidates, humanPlayer)
  if (criticalCells.length === 1) {
    return criticalCells[0]
  }
  if (criticalCells.length >= 2) {
    // 한 수로 다 못 막는 다중 위협(예: 이미 만들어진 열린사) — 그나마 가장 가치 있는
    // 한 곳이라도 막는다. 상대가 착수 하나로 이런 다중 위협을 새로 만드는 경우라면
    // (예: 열린삼) 그 착수 자리 자체가 critical cell 중 하나로 잡히므로 여기서 막힘
    return criticalCells
      .map(c => ({ ...c, heuristic: scoreCell(board, c.row, c.col, aiPlayer) }))
      .sort((a, b) => b.heuristic - a.heuristic)[0]
  }

  // VCF(연속사 강제 승리 수순) 탐색 - 있으면 그 수순의 첫 수를 바로 둔다
  const vcf = searchVCF(board, aiPlayer, 0)
  if (vcf) return vcf[0]

  // 반복심화 + Transposition Table 탐색 (시간 예산 TIME_BUDGET_MS 안에서 최대한 깊이)
  return iterativeDeepeningSearch(board, candidates, aiPlayer, TIME_BUDGET_MS)
}
