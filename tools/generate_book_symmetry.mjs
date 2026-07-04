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

// 같은 key에 서로 다른 move가 경합하면(흑3 선택지가 방향당 4개라 ply3에서 발생) 먼저 나온 것만 채택
const seen = new Map()
const conflicts = []
for (const e of rawEntries) {
  const existing = seen.get(e.key)
  if (!existing) {
    seen.set(e.key, e)
  } else if (existing.move.row !== e.move.row || existing.move.col !== e.move.col) {
    conflicts.push({ key: e.key, kept: existing, dropped: e })
  }
  // 완전히 동일한 key+move 중복은 조용히 무시(회전 대칭으로 우연히 같아진 경우 등)
}

const finalEntries = [...seen.values()]

console.error(`총 원시 항목: ${rawEntries.length}, 충돌로 스킵: ${conflicts.length}, 최종: ${finalEntries.length}`)
if (conflicts.length > 0) {
  console.error('--- 충돌 상세 (ply3 흑 선택지 경합 예상) ---')
  for (const c of conflicts) {
    console.error(`  key=${c.key}\n    유지: ${c.kept.source} ply${c.kept.ply} -> (${c.kept.move.row},${c.kept.move.col})\n    스킵: ${c.dropped.source} ply${c.dropped.ply} -> (${c.dropped.move.row},${c.dropped.move.col})`)
  }
}

// 이미 놓인 자리에 재착수하는 항목이 있는지 안전 검사
let selfCollision = 0
for (const e of finalEntries) {
  const occupied = new Set(e.key.split('|').map(s => s.split(',').slice(0, 2).join(',')))
  if (occupied.has(`${e.move.row},${e.move.col}`)) {
    selfCollision++
    console.error('자기충돌!', e)
  }
}
console.error(`자기충돌(이미 놓인 자리): ${selfCollision}`)

// openingBook.js에 붙여넣을 수 있는 형태로 출력 (플라이별로 정렬해 가독성 확보)
finalEntries.sort((a, b) => a.ply - b.ply || a.source.localeCompare(b.source))
const lines = finalEntries.map(e => `  { key: '${e.key}', move: { row: ${e.move.row}, col: ${e.move.col} } }, // ${e.source} ply${e.ply}`)
console.log(lines.join('\n'))
