// RIF ★★★ 8개 라인(query-yixin-line.mjs로 얻음, 흑1-백2 방향이 "위"/"우상대각"
// 하나씩으로 고정돼 있었음)을 90도 회전으로 나머지 방향까지 전부 커버하도록 확장하고,
// 백 차례뿐 아니라 흑 차례 국면도 함께 오프닝북 항목으로 뽑아내는 스크립트.
// 렌주 금수 판정도 회전 대칭이라(33/44/장목 전부 상대적 모양만 봄) 회전된 좌표도
// 그대로 유효한 수순이다. 사용법: node tools/generate_book_symmetry.mjs
const CENTER = 7

// query-yixin-line.mjs 실행 결과 그대로 (흑1=중앙 고정, moves는 [row,col,player] 8개)
const BASE_LINES = {
  D1: [[7,7,1],[6,7,2],[5,7,1],[6,6,2],[6,8,1],[5,9,2],[7,9,1],[4,6,2]],
  D4: [[7,7,1],[6,7,2],[6,8,1],[5,9,2],[7,6,1],[7,8,2],[5,6,1],[6,6,2]],
  D7: [[7,7,1],[6,7,2],[7,9,1],[7,8,2],[8,9,1],[9,9,2],[8,10,1],[6,8,2]],
  D11: [[7,7,1],[6,7,2],[9,7,1],[6,6,2],[6,8,1],[8,6,2],[7,6,1],[7,8,2]],
  I3: [[7,7,1],[6,8,2],[7,9,1],[7,8,2],[8,8,1],[9,9,2],[9,7,1],[6,10,2]],
  I4: [[7,7,1],[6,8,2],[8,9,1],[6,7,2],[8,8,1],[9,9,2],[6,9,1],[7,10,2]],
  I7: [[7,7,1],[6,8,2],[8,8,1],[6,6,2],[7,9,1],[9,7,2],[6,9,1],[8,9,2]],
  I12: [[7,7,1],[6,8,2],[9,6,1],[7,8,2],[5,8,1],[6,7,2],[6,6,1],[8,8,2]],
  // 2026-07-05 사용자 요청으로 추가(우월/운월/은월). query-yixin-line.mjs 재실행 결과 —
  // Yixin 자체가 실행마다 약간 다른 응수를 줄 수 있어(비결정적) 기존 8개는 그대로 두고
  // 이 3개만 새로 추가
  D6: [[7,7,1],[6,7,2],[7,8,1],[7,9,2],[7,6,1],[7,5,2],[8,7,1],[6,5,2]],
  I6: [[7,7,1],[6,8,2],[7,8,1],[7,6,2],[6,6,1],[8,8,2],[6,7,1],[8,9,2]],
  I9: [[7,7,1],[6,8,2],[8,7,1],[9,7,2],[7,6,1],[6,5,2],[7,8,1],[7,9,2]],
}

// 중심(7,7) 기준 시계방향 90도 회전: (dr,dc) -> (dc,-dr)
// 위(-1,0) -> 오른쪽(0,1) -> 아래(1,0) -> 왼쪽(0,-1) -> 위 로 순환 확인됨
function rotate([r, c, p], k) {
  let dr = r - CENTER, dc = c - CENTER
  for (let i = 0; i < k; i++) {
    const ndr = dc, ndc = -dr
    dr = ndr; dc = ndc
  }
  return [CENTER + dr, CENTER + dc, p]
}

function boardKey(stones) {
  return stones.map(([r, c, p]) => `${r},${c},${p}`).sort().join('|')
}

const allLines = []
for (const [name, moves] of Object.entries(BASE_LINES)) {
  for (let k = 0; k < 4; k++) {
    allLines.push({ name: `${name}-r${k}`, moves: moves.map(m => rotate(m, k)) })
  }
}

// 각 라인에서 "다음 둘 차례"별 (prefix, move) 항목을 전부 뽑는다.
// n=1(흑1 다음, 사실상 항상 중앙이라 의미 없어 건너뜀)부터 n=7(백8)까지.
const rawEntries = []
for (const line of allLines) {
  for (let n = 2; n < line.moves.length; n++) {
    const prefix = line.moves.slice(0, n)
    const mv = line.moves[n]
    rawEntries.push({ key: boardKey(prefix), move: { row: mv[0], col: mv[1] }, source: line.name, ply: n + 1 })
  }
}

// 같은 key에 서로 다른 move가 경합하면(흑3 선택지가 방향당 여러 개라 ply3에서 발생)
// 하나만 골라 나머지를 버리지 않고, 전부 후보로 모아 lookupBook이 무작위로 고르게 한다
// (openingBook.js의 moves 배열 참고) — 예전엔 "먼저 나온 것만 채택"이라 흑 오프닝이
// 방향당 딱 하나로 고정되는 문제가 있었다(사용자 실전 관찰로 발견: 상하좌우는 항상
// 한성D1, 대각선은 항상 항성I3만 나옴).
const grouped = new Map() // key -> Map(moveKey -> {move, sources})
for (const e of rawEntries) {
  const moveKey = `${e.move.row},${e.move.col}`
  if (!grouped.has(e.key)) grouped.set(e.key, new Map())
  const moves = grouped.get(e.key)
  if (!moves.has(moveKey)) moves.set(moveKey, { move: e.move, sources: [] })
  moves.get(moveKey).sources.push(`${e.source} ply${e.ply}`)
}

const finalEntries = [...grouped.entries()].map(([key, moves]) => {
  const entries = [...moves.values()]
  return { key, moves: entries.map(m => m.move), sourcesLabel: entries.map(m => m.sources[0]).join(' / ') }
})

const multiCount = finalEntries.filter(e => e.moves.length > 1).length
console.error(`총 원시 항목: ${rawEntries.length}, 최종 키 개수: ${finalEntries.length}, 그중 후보 2개 이상(다양성 확보): ${multiCount}`)

// 이미 놓인 자리에 재착수하는 후보가 있는지 안전 검사
let selfCollision = 0
for (const e of finalEntries) {
  const occupied = new Set(e.key.split('|').map(s => s.split(',').slice(0, 2).join(',')))
  for (const mv of e.moves) {
    if (occupied.has(`${mv.row},${mv.col}`)) { selfCollision++; console.error('자기충돌!', e.key, mv) }
  }
}
console.error(`자기충돌(이미 놓인 자리): ${selfCollision}`)

// openingBook.js에 붙여넣을 수 있는 형태로 출력
const lines = finalEntries.map(e => {
  const movesStr = e.moves.map(mv => `{ row: ${mv.row}, col: ${mv.col} }`).join(', ')
  return `  { key: '${e.key}', moves: [${movesStr}] }, // ${e.sourcesLabel}`
})
console.log(lines.join('\n'))
