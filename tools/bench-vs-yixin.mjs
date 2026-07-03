// Yixin(로컬 설치된 Gomocup 상위권 엔진) 상대 벤치마크.
//
// 자가대국(미러매치)은 신/구 버전이 같은 엔진 계열이라 같은 맹점을 공유해
// 진짜 실력 변화를 놓칠 수 있다 (VCT 6승 6패, 평가함수 정교화 16승 14패로
// 둘 다 "중립"처럼 보였던 문제). 고정된 독립 상대(Yixin)와 붙여서 승/무/패를
// 비교하면 훨씬 신뢰도 높은 신호를 얻을 수 있다.
//
// 사전 준비: C:\Yixin 에 Yixin이 설치되어 있어야 함 (engine.exe가 pbrain
// 프로토콜로 stdin/stdout 통신). 실행: `node tools/bench-vs-yixin.mjs`
// 다른 버전과 비교하려면 아래 CONFIG.ENGINE_MODULE_PATH만 바꿔서 재실행.
//
// 모든 착수는 반드시 BEGIN/TURN 프로토콜을 통해 실시간으로 Yixin에 전달한다.
// (한때 오프닝 수순을 보드에 미리 놓고 Yixin에는 알리지 않는 방식으로 시도했다가
// Yixin이 그 돌의 존재를 모른 채 그 자리에 자기 수를 두면서 충돌 → 즉시 "무승부"로
// 잘못 종료되는 버그가 있었다. 다양성은 내 엔진 자체의 오프닝 랜덤 응수로 확보한다.)
//
// 규칙은 항상 렌주룰(흑 금수 적용)로 맞춘다 — 프로덕션이 렌주룰이고, 자유룰은 흑(선공)이
// 원래 압도적으로 유리해 "AI가 약해서 지는지" "자유룰이라 원래 이러기 어려운지"를
// 구분할 수 없었다 (INFO rule 4 = RULE_RENJU. 인위적으로 33 자리를 만들어 Yixin이
// 실제로 그 자리를 피하는 것을 실측 확인함).
//
// 현재 AI는 프로덕션에서 항상 백만 두고(금수 제한 없음), 흑 쪽 금수 회피 로직이
// aiEngine.js에 없어 이 벤치마크가 내 엔진을 흑으로 테스트하는 건 아직 무의미하다.
// 그래서 MY_COLOR=2(백) 고정으로만 테스트한다.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG = {
  ENGINE_PATH: 'C:/Yixin/engine.exe',
  // 커맨드라인 인자로 비교할 엔진 모듈 경로를 넘기면 그걸 쓰고, 없으면 기본(현재 HEAD)
  ENGINE_MODULE_PATH: process.argv[2] || path.join(__dirname, '../client/src/utils/aiEngine.js'),
  GAMES: 6,
  MY_COLOR: 2, // 프로덕션과 동일 조건(백). 흑 지원은 aiEngine.js에 금수 회피가 생긴 뒤 추가
  TIME_BUDGET_MS: 2000, // aiEngine.js의 TIME_BUDGET_MS와 맞춤 (공정 비교)
  // Yixin 사고시간. 2000ms 기준으로는 늘 0/6~0/12로 "바닥"에 붙어서 어떤 변경을 해도
  // 승패로는 구별이 안 됐다(자가대국에선 뚜렷했던 개선도 Yixin전에선 그대로 0승).
  // 일부러 약하게(예: 500ms) 낮춰서 팽팽한 상대로 만들면 내 엔진의 작은 개선도
  // 승패에 반영될 가능성이 높아진다 — 목표는 Yixin을 이기는 게 아니라 변경들을
  // 상대적으로 판별할 민감도를 확보하는 것.
  YIXIN_TIME_BUDGET_MS: process.argv[3] ? Number(process.argv[3]) : 500,
  BOARD_SIZE: 15,
  MOVE_TIMEOUT_MS: 10000, // Yixin 응답 대기 최대 시간(행 방지 안전장치)
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]

function emptyBoard(n) {
  return Array.from({ length: n }, () => Array(n).fill(0))
}

function checkWin(board, r, c, player, n) {
  for (const [dr, dc] of DIRS) {
    let count = 1
    for (let d = 1; d <= 4; d++) {
      const rr = r + dr * d, cc = c + dc * d
      if (rr < 0 || rr >= n || cc < 0 || cc >= n || board[rr][cc] !== player) break
      count++
    }
    for (let d = 1; d <= 4; d++) {
      const rr = r - dr * d, cc = c - dc * d
      if (rr < 0 || rr >= n || cc < 0 || cc >= n || board[rr][cc] !== player) break
      count++
    }
    if (count >= 5) return true
  }
  return false
}

// ---- pbrain 프로토콜 브릿지 ----
// 좌표는 Gomocup 표준(X,Y = 열,행, 0-indexed)이고 board[row][col] 표기와
// 순서가 다르므로 변환이 필요하다 (toXY/fromXY). 세로 열린삼 테스트로
// x=열(col), y=행(row) 매핑이 맞는 것을 실측 확인했다.
function createYixinBridge(enginePath, boardSize, timeoutTurnMs, moveTimeoutMs) {
  const proc = spawn(enginePath, [], { cwd: path.dirname(enginePath) })
  let buf = ''
  const pending = []

  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      if (/^\d+,\d+$/.test(line) && pending.length > 0) {
        pending.shift().resolve(line)
      }
      // MESSAGE/DEBUG/OK/ERROR 등은 로그로 무시
    }
  })
  proc.on('error', (err) => {
    while (pending.length) pending.shift().reject(err)
  })

  function send(cmd) {
    proc.stdin.write(cmd + '\n')
  }

  function waitForMove() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = pending.indexOf(entry)
        if (idx >= 0) pending.splice(idx, 1)
        reject(new Error(`Yixin 응답 타임아웃(${moveTimeoutMs}ms)`))
      }, moveTimeoutMs)
      const entry = {
        resolve: (line) => { clearTimeout(timer); resolve(line) },
        reject: (err) => { clearTimeout(timer); reject(err) },
      }
      pending.push(entry)
    })
  }

  function toXY({ row, col }) {
    return `${col},${row}`
  }
  function fromXY(line) {
    const [x, y] = line.split(',').map(Number)
    return { row: y, col: x }
  }

  send(`INFO timeout_turn ${timeoutTurnMs}`)
  send('INFO timeout_match 600000')
  send('INFO rule 4') // RULE_RENJU — 프로덕션과 동일하게 흑 금수 적용
  send(`START ${boardSize}`)

  return {
    async begin() {
      const movePromise = waitForMove()
      send('BEGIN')
      return fromXY(await movePromise)
    },
    async turn(move) {
      const movePromise = waitForMove()
      send(`TURN ${toXY(move)}`)
      return fromXY(await movePromise)
    },
    close() {
      try { send('END') } catch { /* 이미 종료됐으면 무시 */ }
      proc.kill()
    },
  }
}

// myColor: 내 엔진의 돌 색 (1=흑=선공, 2=백=후공, 프로덕션은 항상 2)
async function playGame(engineModule, myColor, config) {
  const n = config.BOARD_SIZE
  const board = emptyBoard(n)
  const moves = []
  const yixin = createYixinBridge(config.ENGINE_PATH, n, config.YIXIN_TIME_BUDGET_MS, config.MOVE_TIMEOUT_MS)
  const yixinColor = myColor === 1 ? 2 : 1

  function place(row, col, player) {
    board[row][col] = player
    moves.push({ row, col, player })
    return checkWin(board, row, col, player, n)
  }

  function isValid(mv) {
    return mv && mv.row >= 0 && mv.row < n && mv.col >= 0 && mv.col < n && board[mv.row][mv.col] === 0
  }

  try {
    if (myColor === 2) {
      // Yixin(흑)이 선공 — BEGIN으로 첫수를 직접 생성하게 함
      const mv = await yixin.begin()
      if (!isValid(mv)) return finish(0)
      if (place(mv.row, mv.col, yixinColor)) return finish(yixinColor)
    }

    while (moves.length < n * n) {
      const mine = engineModule.getAIMove(board, myColor)
      if (!isValid(mine)) return finish(0)
      if (place(mine.row, mine.col, myColor)) return finish(myColor)

      const theirs = await yixin.turn(mine)
      if (!isValid(theirs)) return finish(0)
      if (place(theirs.row, theirs.col, yixinColor)) return finish(yixinColor)
    }
    return finish(0)
  } finally {
    yixin.close()
  }

  function finish(winner) {
    return { winner, moves }
  }
}

function formatMoves(moves) {
  return moves.map(m => `${m.player === 1 ? '흑' : '백'}(${m.row},${m.col})`).join(' ')
}

async function main() {
  const engineModule = await import(pathToFileURL(CONFIG.ENGINE_MODULE_PATH).href)

  let myWins = 0, yixinWins = 0, draws = 0
  const lostGames = []

  for (let i = 0; i < CONFIG.GAMES; i++) {
    const myColor = CONFIG.MY_COLOR
    const result = await playGame(engineModule, myColor, CONFIG)
    if (result.winner === myColor) myWins++
    else if (result.winner === 0) draws++
    else {
      yixinWins++
      lostGames.push({ game: i, myColor, moves: result.moves })
    }
    console.log(`판 ${i + 1}/${CONFIG.GAMES} (내 엔진=${myColor === 2 ? '백' : '흑'}, ${result.moves.length}수): ` +
      (result.winner === myColor ? '내 엔진 승' : result.winner === 0 ? '무승부' : 'Yixin 승'))
  }

  console.log('---')
  console.log(`총 ${CONFIG.GAMES}판 (내 엔진 ${CONFIG.TIME_BUDGET_MS}ms/수, Yixin ${CONFIG.YIXIN_TIME_BUDGET_MS}ms/수)`)
  console.log(`내 엔진 승: ${myWins}`)
  console.log(`Yixin 승: ${yixinWins}`)
  console.log(`무승부: ${draws}`)

  if (lostGames.length > 0) {
    console.log('---')
    console.log('진 판 수순 (복기용):')
    for (const g of lostGames) {
      console.log(`  판 ${g.game + 1} (내 엔진=${g.myColor === 2 ? '백' : '흑'}): ${formatMoves(g.moves)}`)
    }
  }
}

main().catch(err => {
  console.error('벤치마크 실행 중 오류:', err)
  process.exit(1)
})
