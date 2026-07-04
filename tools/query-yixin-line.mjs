// RIF(렌주 국제연맹) 공인 26개 정석 분류 중 최상위 등급(★★★) 8개 라인을
// 로컬 Yixin에게 BOARD 명령으로 이어서 두게 해 각 라인의 4~8수째를 얻어내는 스크립트.
// 사용법: node tools/query-yixin-line.mjs
import { spawn } from 'node:child_process'

const ENGINE_PATH = 'C:/Yixin/engine.exe'
const BOARD_SIZE = 15
const TIME_BUDGET_MS = 1500
const EXTRA_PLIES = 5 // 3수(흑1,백2,흑3) 이후 몇 수 더 얻을지

// ★★★ 등급 8개 라인. black1=(7,7) 고정.
// 각 항목: 이름, white2(직선/대각 방향), black3(정석을 결정하는 수)
const LINES = [
  { name: 'D1 Cold Star', white2: { row: 6, col: 7 }, black3: { row: 5, col: 7 } },
  { name: 'D4 Flower', white2: { row: 6, col: 7 }, black3: { row: 6, col: 8 } },
  { name: 'D7 Gold Star', white2: { row: 6, col: 7 }, black3: { row: 7, col: 9 } },
  { name: 'D11 Lucky Star', white2: { row: 6, col: 7 }, black3: { row: 9, col: 7 } },
  { name: 'I3 Constant', white2: { row: 6, col: 8 }, black3: { row: 7, col: 9 } },
  { name: 'I4 Water', white2: { row: 6, col: 8 }, black3: { row: 8, col: 9 } },
  { name: 'I7 Bay', white2: { row: 6, col: 8 }, black3: { row: 8, col: 8 } },
  { name: 'I12 Glory', white2: { row: 6, col: 8 }, black3: { row: 9, col: 6 } },
]

function createBridge() {
  const proc = spawn(ENGINE_PATH, [], { cwd: 'C:/Yixin' })
  let buf = ''
  const pending = []

  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      if (/^-?\d+,-?\d+$/.test(line) && pending.length > 0) {
        pending.shift().resolve(line)
      }
    }
  })
  proc.on('error', (err) => { while (pending.length) pending.shift().reject(err) })

  function send(cmd) { proc.stdin.write(cmd + '\n') }

  function waitForMove() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = pending.indexOf(entry)
        if (idx >= 0) pending.splice(idx, 1)
        reject(new Error('Yixin 응답 타임아웃'))
      }, 10000)
      const entry = {
        resolve: (line) => { clearTimeout(timer); resolve(line) },
        reject: (err) => { clearTimeout(timer); reject(err) },
      }
      pending.push(entry)
    })
  }

  send(`INFO timeout_turn ${TIME_BUDGET_MS}`)
  send('INFO timeout_match 600000')
  send('INFO rule 4') // RULE_RENJU
  send(`START ${BOARD_SIZE}`)

  return {
    // moves: [{row,col,player}], player 1=흑 2=백. 다음 둘 색은 board 명령 뒤 엔진이 알아서 결정.
    async nextMove(moves) {
      send('BOARD')
      for (const m of moves) {
        // pbrain BOARD 포맷: x,y,who (who: 1=흑, 2=백 — 실제 색 그대로)
        send(`${m.col},${m.row},${m.player}`)
      }
      send('DONE')
      const line = await waitForMove()
      const [x, y] = line.split(',').map(Number)
      return { row: y, col: x }
    },
    close() {
      try { send('END') } catch { /* ignore */ }
      proc.kill()
    },
  }
}

async function main() {
  for (const line of LINES) {
    const bridge = createBridge()
    const moves = [
      { row: 7, col: 7, player: 1 },
      { ...line.white2, player: 2 },
      { ...line.black3, player: 1 },
    ]
    try {
      for (let i = 0; i < EXTRA_PLIES; i++) {
        const nextPlayer = moves.length % 2 === 0 ? 1 : 2 // 홀수개 두면 다음은 백(2)
        const mv = await bridge.nextMove(moves)
        moves.push({ ...mv, player: nextPlayer })
      }
    } catch (err) {
      console.error(`[${line.name}] 오류:`, err.message)
    } finally {
      bridge.close()
    }
    console.log(`--- ${line.name} ---`)
    console.log(moves.map(m => `${m.player === 1 ? '흑' : '백'}(${m.row},${m.col})`).join(' '))
  }
}

main().catch(err => {
  console.error('실행 중 오류:', err)
  process.exit(1)
})
