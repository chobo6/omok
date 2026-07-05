// 두 aiEngine.js 버전을 자가대국으로 비교하는 도구.
//
// 지금까지는 세션마다 scratchpad에 임시 스크립트를 새로 만들어 썼는데(docs/todo.md,
// docs/TROUBLESHOOTING.md #14·#15 참고), 이번에 tools/bench-vs-yixin.mjs와 같은
// 자리에 정식으로 남겨 재사용한다.
//
// 기본은 프로덕션과 동일한 시간 기준 예산(TIME_BUDGET_MS)을 쓰지만, --node-budget으로
// 노드 수 기준으로 바꿀 수 있다 — 반복심화 종료조건이 Date.now() 벽시계 기준이라
// 실행 시점마다 미세하게 다른 depth에서 끊겨 자가대국 결과가 흔들리는 문제
// (docs/TROUBLESHOOTING.md #9, #15)를 없애고, 같은 대국을 재실행했을 때 결정론적으로
// 같은 결과가 나오는지 확인하고 싶을 때 이 옵션을 쓴다. (오목은 돌이 절대 제거되지
// 않아 한 게임 안에서 같은 보드가 두 번 나올 수 없으므로, "같은 스크립트를 별도
// 프로세스로 재실행"하는 비교만 결정론 검증으로 유효하다 — 같은 프로세스 안에서
// 동일 보드를 반복 평가하면 세션 내 재사용되는 TT가 누적돼 흔들릴 수 있음.)
//
// 사용법:
//   node tools/self-play.mjs [candidate.js] [baseline.js] [--games=N] [--node-budget=N]
// 인자를 생략하면 candidate/baseline 둘 다 현재 client/src/utils/aiEngine.js를 가리킴
// (같은 파일이라 무의미 — 실제 비교하려면 최소 하나는 다른 경로를 지정해야 함).

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ENGINE_PATH = path.join(__dirname, '../client/src/utils/aiEngine.js')

function parseArgs(argv) {
  const positional = []
  let games = 10
  let nodeBudget = null
  for (const arg of argv) {
    if (arg.startsWith('--games=')) games = Number(arg.slice('--games='.length))
    else if (arg.startsWith('--node-budget=')) nodeBudget = Number(arg.slice('--node-budget='.length))
    else positional.push(arg)
  }
  return {
    candidatePath: positional[0] || DEFAULT_ENGINE_PATH,
    baselinePath: positional[1] || DEFAULT_ENGINE_PATH,
    games,
    nodeBudget,
  }
}

const N = 15
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]

function emptyBoard() {
  return Array.from({ length: N }, () => Array(N).fill(0))
}

function checkWin(board, r, c, player) {
  for (const [dr, dc] of DIRS) {
    let count = 1
    for (let d = 1; d <= 4; d++) {
      const rr = r + dr * d, cc = c + dc * d
      if (rr < 0 || rr >= N || cc < 0 || cc >= N || board[rr][cc] !== player) break
      count++
    }
    for (let d = 1; d <= 4; d++) {
      const rr = r - dr * d, cc = c - dc * d
      if (rr < 0 || rr >= N || cc < 0 || cc >= N || board[rr][cc] !== player) break
      count++
    }
    if (count >= 5) return true
  }
  return false
}

// 5개 오프닝 x 2색 교대 = 기본 10판. --games로 오프닝 개수를 조절(2배가 실제 판수)
const OPENINGS = [
  [[7, 7]],
  [[7, 7], [7, 8]],
  [[7, 7], [8, 8]],
  [[7, 7], [6, 8]],
  [[7, 7], [8, 6], [6, 7]],
]

function playGame(engineBlack, engineWhite, opening, moveOptions) {
  const board = emptyBoard()
  const moves = []
  let turn = 1
  for (const [r, c] of opening) {
    board[r][c] = turn
    moves.push({ row: r, col: c, player: turn })
    if (checkWin(board, r, c, turn)) return { winner: turn, moves }
    turn = turn === 1 ? 2 : 1
  }
  for (let ply = 0; ply < N * N; ply++) {
    const engine = turn === 1 ? engineBlack : engineWhite
    const mv = engine.getAIMove(board, turn, moveOptions)
    if (!mv || board[mv.row][mv.col] !== 0) return { winner: 0, moves, invalid: true }
    board[mv.row][mv.col] = turn
    moves.push({ row: mv.row, col: mv.col, player: turn })
    if (checkWin(board, mv.row, mv.col, turn)) return { winner: turn, moves }
    turn = turn === 1 ? 2 : 1
  }
  return { winner: 0, moves }
}

async function main() {
  const { candidatePath, baselinePath, games, nodeBudget } = parseArgs(process.argv.slice(2))
  const candidate = await import(pathToFileURL(path.resolve(candidatePath)).href)
  const baseline = await import(pathToFileURL(path.resolve(baselinePath)).href)
  const moveOptions = nodeBudget ? { nodeBudget } : undefined
  const openings = OPENINGS.slice(0, Math.ceil(games / 2))

  // 판마다 TT를 비워 프로덕션의 "게임당 새 워커" 조건과 맞춘다 — 안 비우면 앞 판의
  // 잔여 TT가 뒤 판에 새어들어 재실행할 때마다 결과가 달라지는 문제가 있었다
  // (aiEngine.js의 resetSearchState 주석 참고). 구버전 엔진과 비교할 때는 이 함수가
  // 없을 수 있으니 있을 때만 호출
  const resetBoth = () => { candidate.resetSearchState?.(); baseline.resetSearchState?.() }

  let candidateWins = 0, baselineWins = 0, draws = 0
  let gameNum = 0
  for (const opening of openings) {
    gameNum++
    resetBoth()
    let r = playGame(candidate, baseline, opening, moveOptions)
    if (r.winner === 1) candidateWins++
    else if (r.winner === 2) baselineWins++
    else draws++
    console.log(`판${gameNum} (신규=흑) ${r.moves.length}수: ${r.winner === 1 ? '신규 승' : r.winner === 2 ? '베이스 승' : '무승부'}`)

    gameNum++
    resetBoth()
    r = playGame(baseline, candidate, opening, moveOptions)
    if (r.winner === 2) candidateWins++
    else if (r.winner === 1) baselineWins++
    else draws++
    console.log(`판${gameNum} (신규=백) ${r.moves.length}수: ${r.winner === 2 ? '신규 승' : r.winner === 1 ? '베이스 승' : '무승부'}`)
  }

  console.log('---')
  console.log(`총 ${gameNum}판 (${nodeBudget ? `노드예산 ${nodeBudget}` : '시간예산(프로덕션 기본)'}) — 신규: ${candidatePath === DEFAULT_ENGINE_PATH ? '(기본=현재 HEAD)' : candidatePath}, 베이스: ${baselinePath === DEFAULT_ENGINE_PATH ? '(기본=현재 HEAD)' : baselinePath}`)
  console.log('신규 승:', candidateWins)
  console.log('베이스 승:', baselineWins)
  console.log('무승부:', draws)
}

main().catch(err => {
  console.error('실행 중 오류:', err)
  process.exit(1)
})
