// RIF(렌주 국제연맹) 공인 26개 정석 분류 중 흑에게 유리하다고 평가되는 라인들을
// 로컬 Yixin에게 BOARD 명령으로 이어서 두게 해 각 라인의 4~8수째를 얻어내는 스크립트.
// 사용법: node tools/query-yixin-line.mjs
//
// 처음 8개(D1,D4,D7,D11,I3,I4,I7,I12)는 Nosovsky·Sokolsky "Renju For Beginners"
// (RIF 공식)의 ★★★ 등급. 뒤 3개(D6,I6,I9)는 사용자가 이름으로 지정한 우월/운월/은월 —
// 한국 렌주 커뮤니티 자료(화월=D4·포월=I7과 교차검증됨, 둘 다 "흑 필승/흑 유리" 평가)
// 기준으로 추가. 좌표는 Wikipedia Renju_opening_pattern 공식 다이어그램에서 읽은
// 흑3 상대좌표를 그대로 사용(client/src/utils/openingBook.js 헤더 주석 참고).
import { spawn } from 'node:child_process'

const ENGINE_PATH = 'C:/Yixin/engine.exe'
const BOARD_SIZE = 15
const TIME_BUDGET_MS = 1500
const EXTRA_PLIES = 5 // 3수(흑1,백2,흑3) 이후 몇 수 더 얻을지

// black1=(7,7) 고정. 각 항목: 이름, white2(직선/대각 방향), black3(정석을 결정하는 수)
const LINES = [
  { name: 'D1 Cold Star', white2: { row: 6, col: 7 }, black3: { row: 5, col: 7 } },
  { name: 'D4 Flower(화월)', white2: { row: 6, col: 7 }, black3: { row: 6, col: 8 } },
  { name: 'D6 Uwol(우월)', white2: { row: 6, col: 7 }, black3: { row: 7, col: 8 } },
  { name: 'D7 Gold Star', white2: { row: 6, col: 7 }, black3: { row: 7, col: 9 } },
  { name: 'D11 Lucky Star', white2: { row: 6, col: 7 }, black3: { row: 9, col: 7 } },
  { name: 'I3 Constant', white2: { row: 6, col: 8 }, black3: { row: 7, col: 9 } },
  { name: 'I4 Water', white2: { row: 6, col: 8 }, black3: { row: 8, col: 9 } },
  { name: 'I6 Unwol(운월)', white2: { row: 6, col: 8 }, black3: { row: 7, col: 8 } },
  { name: 'I7 Bay(포월)', white2: { row: 6, col: 8 }, black3: { row: 8, col: 8 } },
  { name: 'I9 Eunwol(은월)', white2: { row: 6, col: 8 }, black3: { row: 8, col: 7 } },
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
