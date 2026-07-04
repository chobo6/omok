import { checkForbidden } from './forbidden.js'
import { lookupBook } from './openingBook.js'

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
  let myFourDirs = 0
  let myThreeDirs = 0
  let enemyFourDirs = 0
  let enemyThreeDirs = 0

  for (const [dr, dc] of DIRECTIONS) {
    const line = buildLine(board, row, col, dr, dc)
    const mine = analyzeDirection(line, player)
    const enemy = analyzeDirection(line, opp)

    if (mine.five) score += 100000
    else if (mine.fourWindows >= 1) { score += 10000; myFourDirs++ }
    else if (mine.threeWindows >= 2) { score += 1000; myThreeDirs++ }
    else if (mine.threeWindows === 1) { score += 100; myThreeDirs++ }
    else if (mine.twoWindows >= 2) score += 10

    if (enemy.five) score += 50000
    else if (enemy.fourWindows >= 1) { score += 8000; enemyFourDirs++ }
    else if (enemy.threeWindows >= 2) { score += 500; enemyThreeDirs++ }
    else if (enemy.threeWindows === 1) enemyThreeDirs++ // 점수는 없지만(비대칭 평가) 포크 판정엔 반영
  }

  // 복합 위협(포크) 보너스: 서로 다른 두 방향에서 동시에 위협이 겹치면 한 수로 둘 다
  // 못 막으므로, 단순 합산보다 훨씬 위험/유리함을 반영
  if (myFourDirs >= 2) score += 80000
  else if (myFourDirs >= 1 && myThreeDirs >= 1) score += 5000

  if (enemyFourDirs >= 2) score += 40000
  else if (enemyFourDirs >= 1 && enemyThreeDirs >= 1) score += 2500

  return score
}

// bbox(돌이 놓인 영역의 최소 사각형)를 넘기면 그 영역(+range)만 스캔한다.
// 생략 시 보드 전체를 스캔(기존 동작과 동일) — bbox 밖에는 돌이 없다는 게 보장될 때만 안전하므로,
// 탐색 트리 내부(negamax)에서 매 노드 착수마다 갱신되는 bbox를 넘겨받아 쓴다
const FULL_BBOX = { minR: 0, maxR: BOARD_SIZE - 1, minC: 0, maxC: BOARD_SIZE - 1 }

function getCandidates(board, bbox = FULL_BBOX, range = 2) {
  const candidates = new Set()
  const rLo = Math.max(0, bbox.minR - range)
  const rHi = Math.min(BOARD_SIZE - 1, bbox.maxR + range)
  const cLo = Math.max(0, bbox.minC - range)
  const cHi = Math.min(BOARD_SIZE - 1, bbox.maxC + range)

  for (let r = rLo; r <= rHi; r++) {
    for (let c = cLo; c <= cHi; c++) {
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

// 현재 보드에 놓인 돌들의 최소 바운딩박스. 탐색 시작 시 한 번만 계산하고,
// 이후 negamax 재귀에서는 착수할 때마다 expandBBox로 값만 갱신(보드 재스캔 없음)
function computeBBox(board) {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) continue
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c
    }
  }
  if (minR === Infinity) {
    const mid = Math.floor(BOARD_SIZE / 2)
    return { minR: mid, maxR: mid, minC: mid, maxC: mid }
  }
  return { minR, maxR, minC, maxC }
}

function expandBBox(bbox, row, col) {
  return {
    minR: Math.min(bbox.minR, row),
    maxR: Math.max(bbox.maxR, row),
    minC: Math.min(bbox.minC, col),
    maxC: Math.max(bbox.maxC, col),
  }
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
// 위협을 절반만 막고 나머지 절반을 방치하는 문제가 생기므로, 반드시 전부 모아야 함.
// opponent가 흑이면, 그 자리 자체가 흑의 금수(33/44/장목)인 경우는 위협에서 제외한다 —
// 실제 서버 로직(server/index.js)이 금수를 승패 판정보다 먼저 확인해 흑이 그 자리에
// 두면 (설령 5목이 완성되더라도) 무조건 즉시 패배 처리하므로, 백이 막을 필요가 없다
function findCriticalDefenseCells(board, candidates, opponent) {
  const critical = []
  for (const { row, col } of candidates) {
    if (opponent === 1 && checkForbidden(board, row, col) !== null) continue
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

// candidates 중 player가 두면 즉시 5목이 되는 자리가 있는지 확인.
// player가 흑이면 그 자리가 금수(33/44/장목)인 경우는 제외 — 흑은 그 자리에 두면
// 5목이 완성되든 말든 즉시 패배하므로(server/index.js가 금수를 승패보다 먼저 확인),
// "즉시 승리"가 아니라 "즉시 패배" 자리다
function hasImmediateWin(board, candidates, player) {
  for (const { row, col } of candidates) {
    if (player === 1 && checkForbidden(board, row, col) !== null) continue
    board[row][col] = player
    const wins = checkWinBoard(board, row, col, player)
    board[row][col] = 0
    if (wins) return true
  }
  return false
}

// VCF(Victory by Continuous Fours): 사(四)만 연속으로 만들어 상대를 강제로 방어시키며 오목을 완성하는 수순 탐색.
// 상대는 유일한 완성 지점을 막는다고 가정하되, 그 전에 상대에게 우리가 강제하기도 전에
// 즉시 이길 수 있는 수가 생기지 않았는지(=상대 반격) 매 단계 확인한다.
// (우리가 사를 만드는 동안 상대에게 억지로 두게 한 방어 돌들이 누적되면서, 상대의 기존
// 돌과 우연히 이어져 상대의 5목/사 위협이 새로 생길 수 있음 — 그 경우 상대는 막지 않고
// 그냥 이겨버리므로 이 수순은 강제승리가 아님)
function searchVCF(board, player, depth) {
  if (depth >= VCF_MAX_DEPTH) return null

  const opponent = player === 1 ? 2 : 1

  for (const { row, col, completions } of findFourMoves(board, player)) {
    board[row][col] = player

    if (checkWinBoard(board, row, col, player)) {
      board[row][col] = 0
      return [{ row, col }] // 지금 이 수로 실제 5목 완성 — 상대 턴 자체가 없는 즉시 승리
    }

    // 상대 반격 확인: 여기부터는(오픈사 주장이든, 이후 강제 블록이든) 다음은 상대 차례이므로,
    // 상대에게 이미 즉시 승리 수가 있으면 상대는 막지 않고 그 수로 먼저 이겨버림.
    // 특히 완성 지점이 2곳 이상(오픈사)이라 해도 상대가 그보다 먼저 이길 수 있으면 가짜 승리 주장임
    if (hasImmediateWin(board, getCandidates(board), opponent)) {
      board[row][col] = 0
      continue
    }

    if (completions.length >= 2) {
      board[row][col] = 0
      return [{ row, col }] // 완성 지점 2곳 이상 & 상대 반격 없음 확인됨 — 진짜 강제승리
    }

    const block = completions[0]

    // 렌주 금수 활용: 완성 지점이 1곳뿐이어도, 상대가 흑이고 그 자리가 흑에게 금수(33/44/장목)면
    // 상대는 거기 못 막는다 — 두면 즉시 패배(server/index.js가 금수를 승패보다 먼저 판정), 안
    // 두면 다음 수에 우리가 오목 완성. 완성 지점 2곳 이상(오픈사)과 동일하게 확정 승리로 처리
    if (opponent === 1 && checkForbidden(board, block.row, block.col) !== null) {
      board[row][col] = 0
      return [{ row, col }]
    }

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

const WIN_SCORE = 10000000
const TT_EXACT = 0
const TT_LOWER = 1
const TT_UPPER = 2
const MAX_CANDIDATES_PER_NODE = 20
const TIME_BUDGET_MS = 2000
const MAX_SEARCH_DEPTH = 12
// 이 개수 미만으로 돌이 놓인 국면(대략 오프닝 단계)에서는 후보 생성 반경을 2에서
// 1로 좁힌다 — iterativeDeepeningSearch 주석 참고
const SPARSE_STONE_THRESHOLD = 8

// 5칸 윈도우 안의 (내 돌 개수)별 가중치. 상대 돌이 섞인 윈도우는 위협이 아니므로 0.
// 윈도우를 보드 전체에서 "한 번씩만" 세기 때문에, 기존 evaluate처럼 돌 개수만큼
// 같은 위협을 중복 계산하던 문제(열린삼 1개를 3000으로 부풀리던 것)가 사라진다.
const WINDOW_WEIGHTS = [0, 1, 100, 1000, 10000, 100000] // index = 윈도우 내 내 돌 개수(0~5)

// ---- 증분 평가(incremental evaluation) ----
// 예전 boardScore()는 leaf 노드마다 보드 전체(4방향×15×15 윈도우)를 처음부터 다시 스캔했다.
// 탐색 트리에서 leaf는 수천~수만 번 방문되므로 이게 가장 큰 병목이었다. 여기서는 보드 위
// 모든 5칸 윈도우를 미리 한 번만 열거해두고(CELL_WINDOWS), 각 윈도우에 들어있는 흑/백 돌
// 개수만 배열로 유지하다가 착수/취소 때 그 돌이 속한 윈도우들(최대 4방향×5=20개)만 갱신한다.
// 점수 공식(WINDOW_WEIGHTS 합산 규칙)은 기존 boardScore와 100% 동일 — 속도만 바꾼 것이며
// 평가 로직/기물 배치 판단은 전혀 바뀌지 않는다(무작위 대국 검증으로 완전 일치 확인됨).
function buildWindowGeometry() {
  const cellWindows = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => [])
  let windowId = 0
  for (const [dr, dc] of DIRECTIONS) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const endR = r + dr * 4
        const endC = c + dc * 4
        if (endR < 0 || endR >= BOARD_SIZE || endC < 0 || endC >= BOARD_SIZE) continue
        for (let i = 0; i < 5; i++) {
          const rr = r + dr * i, cc = c + dc * i
          cellWindows[rr * BOARD_SIZE + cc].push(windowId)
        }
        windowId++
      }
    }
  }
  return { cellWindows, numWindows: windowId }
}
const { cellWindows: CELL_WINDOWS, numWindows: NUM_WINDOWS } = buildWindowGeometry()

// 탐색 중인 board 배열 하나에 대응하는 증분 평가 상태. iterativeDeepeningSearch 시작 시
// 한 번만 O(board)로 초기화하고, 이후 negamax/rootSearch의 착수·취소마다
// applyStoneDelta로만 갱신한다(보드 재스캔 없음).
function createEvalState(board) {
  const state = {
    winCount1: new Uint8Array(NUM_WINDOWS),
    winCount2: new Uint8Array(NUM_WINDOWS),
    score1: 0,
    score2: 0,
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const v = board[r][c]
      if (v !== 0) applyStoneDelta(state, r * BOARD_SIZE + c, v, 1)
    }
  }
  return state
}

// idx 위치에 player 돌을 놓거나(sign=1) 치울(sign=-1) 때, 그 돌이 속한 모든 윈도우의
// 흑/백 카운트와 두 플레이어의 누적 점수를 함께 갱신한다.
// (상대 카운트는 이 호출 동안 안 바뀌므로 "막힘 여부" 판정이 갱신 전/후 모두 안전하게 성립)
function applyStoneDelta(state, idx, player, sign) {
  const mineCounts = player === 1 ? state.winCount1 : state.winCount2
  const oppCounts = player === 1 ? state.winCount2 : state.winCount1
  const windows = CELL_WINDOWS[idx]
  let mineDelta = 0
  let oppDelta = 0
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const opp = oppCounts[w]
    const oldMine = mineCounts[w]
    if (opp === 0) mineDelta -= WINDOW_WEIGHTS[oldMine]
    if (oldMine === 0) oppDelta -= WINDOW_WEIGHTS[opp]

    const newMine = oldMine + sign
    mineCounts[w] = newMine

    if (opp === 0) mineDelta += WINDOW_WEIGHTS[newMine]
    if (newMine === 0) oppDelta += WINDOW_WEIGHTS[opp]
  }
  if (player === 1) { state.score1 += mineDelta; state.score2 += oppDelta }
  else { state.score2 += mineDelta; state.score1 += oppDelta }
}

// side(1|2) 관점 평가. 양수면 side에게 유리 (기존 evaluate(board,side)와 값 동일, O(1))
function evaluate(state, side) {
  return side === 1 ? state.score1 - state.score2 : state.score2 - state.score1
}

// 루트에서 여러 후보의 negamax 평가값이 완전히 동일할 때(둘 다 "이미 진 판" 등, 실질적
// 차이가 없는 경우) 쓰는 타이브레이크. 평가함수가 순수 패턴 개수 합산이라 "다 똑같이
// 나쁘면" 아무 자리나 고를 수 있는데(실전에서 상대와 멀리 떨어진 구석 수를 골라버리는
// 문제로 발견됨), 기존 돌에 가까운 쪽을 우선해 최소한 판을 계속 걸고 늘어지게 한다.
// 탐색 결과 자체(alpha-beta pruning, TT)는 건드리지 않고 루트의 최종 선택에만 영향.
function nearestStoneDistance(board, row, col) {
  let best = Infinity
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) continue
      const d = Math.max(Math.abs(r - row), Math.abs(c - col))
      if (d < best) best = d
    }
  }
  return best
}

// 후보를 매 노드마다 새로 채점·정렬. tt에 저장된 수(ttMove)가 있으면 최우선 탐색
// (트랜스포지션 테이블 적중 시 이전에 좋았던 수부터 보므로 알파베타 가지치기 효율이 오름)
// forcedCells: 루트에서만 쓰이는 파라미터(재귀 호출에는 안 넘김) — 상대의 급한 위협을 막는
// 자리들을 후보가 많아 MAX_CANDIDATES_PER_NODE에 밀려 잘려나가지 않도록 최우선 순위로 고정한다.
// (예전엔 이 자리를 찾으면 tt 없이 즉시 반환해버려 한 수 앞도 못 내다봤는데, 이제는 "반드시
// 고려할 후보"로만 강제하고 실제 선택은 탐색이 하게 한다)
function orderCandidates(board, candidates, side, ttMove, forcedCells) {
  const forcedSet = forcedCells && forcedCells.length > 0
    ? new Set(forcedCells.map(c => `${c.row},${c.col}`))
    : null
  return candidates
    .map(c => ({
      ...c,
      heuristic: (ttMove && c.row === ttMove.row && c.col === ttMove.col) ? Infinity
        : (forcedSet && forcedSet.has(`${c.row},${c.col}`)) ? Infinity
        : scoreCell(board, c.row, c.col, side),
    }))
    .sort((a, b) => b.heuristic - a.heuristic)
    .slice(0, MAX_CANDIDATES_PER_NODE)
}

// side 관점 negamax. 반환값이 양수면 side(지금 둘 차례)에게 유리.
// tt: 이번 getAIMove 호출 한 번 동안만 쓰는 Map 기반 Transposition Table
// deadline: Date.now() 기준 탐색 종료 시각 — 넘으면 그 지점에서 정적 평가로 대체
// bbox: 지금까지 놓인 돌의 바운딩박스(후보 생성 범위 축소용, 착수마다 expandBBox로 갱신)
// state: 증분 평가 상태(착수·취소마다 applyStoneDelta로 함께 갱신)
// range: 후보 생성 반경(getCandidates에 그대로 전달, 초반 희소 국면 최적화용 — 아래 rootSearch 주석 참고)
function negamax(board, depth, alpha, beta, side, hash, tt, deadline, bbox, state, range) {
  const alphaOrig = alpha
  const entry = tt.get(hash)
  if (entry && entry.depth >= depth) {
    if (entry.bound === TT_EXACT) return entry.value
    if (entry.bound === TT_LOWER) alpha = Math.max(alpha, entry.value)
    else if (entry.bound === TT_UPPER) beta = Math.min(beta, entry.value)
    if (alpha >= beta) return entry.value
  }

  if (depth === 0 || Date.now() > deadline) {
    return evaluate(state, side)
  }

  const opponent = side === 1 ? 2 : 1
  const candidates = orderCandidates(board, getCandidates(board, bbox, range), side, entry?.bestMove)

  let best = -Infinity
  let bestMove = null

  for (const { row, col } of candidates) {
    const idx = row * BOARD_SIZE + col
    board[row][col] = side
    applyStoneDelta(state, idx, side, 1)
    if (checkWinBoard(board, row, col, side)) {
      board[row][col] = 0
      applyStoneDelta(state, idx, side, -1)
      const val = WIN_SCORE + depth
      tt.set(hash, { depth, value: val, bound: TT_EXACT, bestMove: { row, col } })
      return val
    }
    const childHash = hash ^ ZOBRIST[row][col][side]
    const childBBox = expandBBox(bbox, row, col)
    const val = -negamax(board, depth - 1, -beta, -alpha, opponent, childHash, tt, deadline, childBBox, state, range)
    board[row][col] = 0
    applyStoneDelta(state, idx, side, -1)

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
function rootSearch(board, candidates, depth, aiPlayer, hash, tt, deadline, bbox, forcedCells, state, range) {
  const opponent = aiPlayer === 1 ? 2 : 1
  const ordered = orderCandidates(board, candidates, aiPlayer, tt.get(hash)?.bestMove, forcedCells)

  let alpha = -Infinity
  let bestMove = null
  let bestScore = -Infinity
  let bestDist = Infinity

  for (const { row, col } of ordered) {
    const idx = row * BOARD_SIZE + col
    board[row][col] = aiPlayer
    applyStoneDelta(state, idx, aiPlayer, 1)
    if (checkWinBoard(board, row, col, aiPlayer)) {
      board[row][col] = 0
      applyStoneDelta(state, idx, aiPlayer, -1)
      return { move: { row, col }, score: WIN_SCORE + depth, complete: true }
    }
    const childHash = hash ^ ZOBRIST[row][col][aiPlayer]
    const childBBox = expandBBox(bbox, row, col)
    const val = -negamax(board, depth - 1, -Infinity, -alpha, opponent, childHash, tt, deadline, childBBox, state, range)
    board[row][col] = 0
    applyStoneDelta(state, idx, aiPlayer, -1)

    if (Date.now() > deadline) {
      return { move: bestMove, score: bestScore, complete: false }
    }

    if (val > bestScore) {
      bestScore = val
      bestMove = { row, col }
      bestDist = nearestStoneDistance(board, row, col)
    } else if (val === bestScore) {
      const dist = nearestStoneDistance(board, row, col)
      if (dist < bestDist) { bestMove = { row, col }; bestDist = dist }
    }
    if (bestScore > alpha) alpha = bestScore
  }

  if (bestMove) tt.set(hash, { depth, value: bestScore, bound: TT_EXACT, bestMove })
  return { move: bestMove, score: bestScore, complete: true }
}

// 반복심화(Iterative Deepening): 시간 예산 안에서 depth 1→2→3…로 점점 깊이 탐색하고,
// 끝까지 완료된 depth의 결과만 채택한다 (도중에 시간이 끝난 depth의 부분 결과는 버림).
// Transposition Table을 depth 사이에서 재사용해 얕은 depth에서 찾은 최선 수가
// 다음 depth의 탐색 순서를 앞당겨준다.
// range: 후보 생성 반경 — 돌이 적은 초반엔 2로 두면 노드당 후보가 너무 많아져(반경 2 안에
// 빈 칸이 넘쳐남) MAX_CANDIDATES_PER_NODE(20)에 항상 꽉 채워 걸리고, 그 결과 매 노드가
// 20-way branching이 되어 실질적으로 도달 가능한 깊이가 급격히 얕아진다. 이 상태에서
// 반복심화가 시간 내에 끝낸 마지막 depth가 하필 미니맥스 특유의 홀짝 진동(depth가 짝수면
// "상대가 마지막에 둔" 시점에서 끝나 비관적으로, 홀수면 낙관적으로 보이는 현상) 중
// 비관적인 짝수 depth였을 때, 실제로는 한 수만 더 보면 뒤집히는 결과를 그대로 채택해버려
// 상대 돌과 전혀 무관한 자리를 고르는 문제가 실전에서 확인됐다(2026-07-05,
// docs/TROUBLESHOOTING.md 참고). range=1로 줄이면 초반엔 후보 수가 자연히
// MAX_CANDIDATES_PER_NODE 밑으로 내려가 같은 시간에 훨씬 깊이(예: depth 6→7) 도달해
// 진동을 지나치고 안정된 결과를 얻는다. 직접인접(반경 1)은 사삼 등 실제 위협의 응수
// 지점을 항상 포함하므로(위협 응수는 항상 형태의 끝에 바로 붙는 자리) 이 시점엔 전술적
// 손실이 없다 — 아직 위협이랄 게 없는 돌 적은 국면에서만 적용되기 때문.
function iterativeDeepeningSearch(board, candidates, aiPlayer, timeBudgetMs, forcedCells) {
  const deadline = Date.now() + timeBudgetMs
  const tt = new Map()
  const rootHash = computeHash(board)
  const rootBBox = computeBBox(board)
  const state = createEvalState(board)
  const range = countStones(board) < SPARSE_STONE_THRESHOLD ? 1 : 2

  let overallBest = (forcedCells && forcedCells[0]) || candidates[0]
  for (let depth = 1; depth <= MAX_SEARCH_DEPTH; depth++) {
    if (Date.now() > deadline) break
    const result = rootSearch(board, candidates, depth, aiPlayer, rootHash, tt, deadline, rootBBox, forcedCells, state, range)
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

  // AI가 흑이면 자기 금수(33/44/장목) 자리는 애초에 후보에서 제외한다 — 흑이 금수를
  // 두면 이기고 지고를 떠나 즉시 패배이므로, 아래 즉시승리/위급방어/탐색 전부 이
  // 필터링된 목록만 보게 해서 최종 선택이 금수가 될 수 없도록 한다. negamax 재귀
  // 내부까지는 필터링하지 않음(매 노드 checkForbidden 호출은 백 전용일 때도 항상
  // 도는 성능 비용이라 기존 탐색 속도를 해칠 위험 — 루트에서 반환하는 수만 방어)
  // range: 돌이 적은 초반엔 1로 좁힘(iterativeDeepeningSearch 주석 참고) — 여기서 만든
  // candidates가 그대로 탐색 루트 후보로도 쓰이므로 재귀 쪽과 반경을 맞춰야 한다
  const rootRange = countStones(board) < SPARSE_STONE_THRESHOLD ? 1 : 2
  const rawCandidates = getCandidates(board, FULL_BBOX, rootRange)
  const forbiddenFiltered = aiPlayer === 1
    ? rawCandidates.filter(({ row, col }) => checkForbidden(board, row, col) === null)
    : rawCandidates
  // 극단적으로 후보 전부가 금수인 경우(사실상 불가능하지만) 빈 배열을 반환해 AI가
  // 착수를 못 하는 것보단, 필터 전 목록으로라도 착수하게 하는 게 안전하다
  const candidates = forbiddenFiltered.length > 0 ? forbiddenFiltered : rawCandidates

  // 빠른 승리/패배 방어 체크
  for (const { row, col } of candidates) {
    board[row][col] = aiPlayer
    if (checkWinBoard(board, row, col, aiPlayer)) {
      board[row][col] = 0
      return { row, col }
    }
    board[row][col] = 0
  }

  // 오프닝북: 지금 국면이 openingBook.js에 저장된 국면(흑/백 어느 쪽 차례든)과
  // 정확히 일치하면 그 응수를 그대로 쓴다. 안 맞으면 null이 반환돼 정상적으로
  // 아래 탐색으로 넘어감 — 즉시 승리 체크 뒤에 둬서 혹시라도 이 시점에 진짜
  // 위급한 즉시 승리 수가 있으면 그쪽이 항상 우선하도록 안전장치를 둠.
  // 키가 보드 상태 전체를 그대로 담고 있어 흑/백 항목이 서로 다른 stone-parity
  // 국면에 걸려 있으므로 색 구분 없이 조회해도 안전하다(흑 차례 국면 키는
  // aiPlayer===1일 때만, 백 차례 국면 키는 aiPlayer===2일 때만 실제로 매치될 수 있음).
  // 다만 흑 항목은 이론상 항상 합법이어야 하지만(Yixin을 RULE_RENJU로 질의)
  // 다른 안전장치들과 동일하게 반환 직전 한 번 더 금수 여부를 확인한다.
  const book = lookupBook(board)
  if (book && board[book.row][book.col] === 0 &&
    !(aiPlayer === 1 && checkForbidden(board, book.row, book.col) !== null)) return book

  const humanPlayer = aiPlayer === 1 ? 2 : 1

  // 내 강제 승리(VCF)를 방어보다 먼저 확인한다.
  // VCF가 성립하면 상대는 매 수 내 사(四)를 막느라 자기 위협을 완성할 틈이 없으므로,
  // 상대가 무슨 위협을 걸어왔든 그냥 밀어붙여 이기는 게 최선이다.
  // (searchVCF는 내부적으로 매 단계 hasImmediateWin으로 상대의 즉시 승리 가능성을 확인하므로,
  //  상대가 지금 당장 이길 수 있는 상황이면 스스로 null을 반환해 아래 방어 로직으로 넘어간다)
  // searchVCF는 findFourMoves 내부에서 매번 새로 getCandidates(board)를 호출해
  // 위 금수 필터링을 안 거치므로, AI가 흑일 때 VCF 결과 자체가 금수일 가능성이
  // (드물지만) 남아있다 — 반환 직전에 한 번 더 확인
  const vcf = searchVCF(board, aiPlayer, 0)
  if (vcf && !(aiPlayer === 1 && checkForbidden(board, vcf[0].row, vcf[0].col) !== null)) return vcf[0]

  // 위급 방어: 상대가 다음 수로 이기거나 한 수로 못 막는 위협을 만드는 자리.
  // 예전엔 이 자리를 찾으면 탐색 없이 즉시 반환했는데, 그러면 상대가 계속 위협을
  // 만들어내는 한(=강한 상대일수록 거의 매 수) AI가 한 수 앞도 못 내다보는 반사적
  // 방어만 반복하게 되는 문제가 있었다(실전 패배 국면 추적으로 확인 — 10수 중 7수가
  // 이 반사 분기였음). 이제는 이 자리들을 강제 후보(forcedCells)로 탐색에 넘겨서,
  // 후보가 많아 밀려나지 않는 것만 보장하고 실제 선택은 반복심화 탐색이 하게 한다.
  const criticalCells = findCriticalDefenseCells(board, candidates, humanPlayer)

  // 반복심화 + Transposition Table 탐색 (시간 예산 TIME_BUDGET_MS 안에서 최대한 깊이)
  return iterativeDeepeningSearch(board, candidates, aiPlayer, TIME_BUDGET_MS, criticalCells)
}
