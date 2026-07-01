const BOARD_SIZE = 15
const DIRS = [[0,1],[1,0],[1,1],[1,-1]]

function cell(board, r, c) {
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return -1
  return board[r][c]
}

// 흑(1) 기준 금수 판정. '장목' | '44' | '33' | null 반환
function checkForbidden(board, row, col, depth = 0) {
  if (board[row][col] !== 0) return null

  board[row][col] = 1
  let result = null

  if (_isOverline(board, row, col)) {
    result = '장목'
  } else {
    let fours = 0
    for (const [dr, dc] of DIRS) {
      if (_hasFour(board, row, col, dr, dc)) fours++
      if (fours >= 2) { result = '44'; break }
    }

    if (!result) {
      let threes = 0
      for (const [dr, dc] of DIRS) {
        if (_hasOpenThree(board, row, col, dr, dc, depth)) threes++
        if (threes >= 2) { result = '33'; break }
      }
    }
  }

  board[row][col] = 0
  return result
}

function _isOverline(board, row, col) {
  for (const [dr, dc] of DIRS) {
    let n = 1
    for (let d = 1; d <= 5; d++) { if (cell(board, row+dr*d, col+dc*d) !== 1) break; n++ }
    for (let d = 1; d <= 5; d++) { if (cell(board, row-dr*d, col-dc*d) !== 1) break; n++ }
    if (n >= 6) return true
  }
  return false
}

// 방향 하나에서 사(四) 여부: 5칸 윈도우 내 흑4+빈1, 빈자리 채우면 정확히 5
function _hasFour(board, row, col, dr, dc) {
  for (let off = 0; off <= 4; off++) {
    const sr = row - off*dr, sc = col - off*dc
    let blacks = 0, er = -1, ec = -1, ok = true, has = false

    for (let i = 0; i < 5; i++) {
      const r = sr+i*dr, c = sc+i*dc
      const v = cell(board, r, c)
      if (v === -1 || v === 2) { ok = false; break }
      if (r === row && c === col) has = true
      if (v === 1) blacks++
      else if (er === -1) { er = r; ec = c }
      else { ok = false; break }
    }
    if (!ok || blacks !== 4 || er === -1 || !has) continue

    // 빈 자리 채웠을 때 정확히 5인지 확인 (장목이면 거짓사)
    board[er][ec] = 1
    let n = 1
    for (let d = 1; d <= 5; d++) { if (cell(board, er+dr*d, ec+dc*d) !== 1) break; n++ }
    for (let d = 1; d <= 5; d++) { if (cell(board, er-dr*d, ec-dc*d) !== 1) break; n++ }
    board[er][ec] = 0

    if (n === 5) return true
  }
  return false
}

// 방향 하나에서 열린삼(三) 여부
// 패턴: 6칸 윈도우에서 _ B B B _ _ 등 → 채우면 열린사 _ B B B B _
// 거짓금수: 채우는 자리 자체가 금수이면 진짜 삼이 아님
function _hasOpenThree(board, row, col, dr, dc, depth) {
  // [패턴(6칸), fillIdx, 흑위치 인덱스들]
  // 채운 결과가 반드시 _ B B B B _ (열린사) 여야 함
  const PATS = [
    [[0,1,1,1,0,0], 4, [1,2,3]],  // _ B B B _ _  → 4번 채움
    [[0,0,1,1,1,0], 1, [2,3,4]],  // _ _ B B B _  → 1번 채움
    [[0,1,0,1,1,0], 2, [1,3,4]],  // _ B _ B B _  → 2번 채움
    [[0,1,1,0,1,0], 3, [1,2,4]],  // _ B B _ B _  → 3번 채움
  ]

  for (let off = 0; off <= 5; off++) {
    const sr = row - off*dr, sc = col - off*dc
    const cells = Array.from({length: 6}, (_, i) => cell(board, sr+i*dr, sc+i*dc))

    for (const [pat, fi, bis] of PATS) {
      if (!cells.every((v, i) => v === pat[i])) continue

      // (row, col) 이 흑 위치에 포함되어야 함
      if (!bis.some(i => sr+i*dr === row && sc+i*dc === col)) continue

      // 채웠을 때 열린사인지 확인 (run=4, 양쪽 빈칸)
      const fr = sr+fi*dr, fc = sc+fi*dc
      board[fr][fc] = 1
      let left = 0, right = 0
      for (let d = 1; d <= 4; d++) { if (cell(board, fr-dr*d, fc-dc*d) !== 1) break; left++ }
      for (let d = 1; d <= 4; d++) { if (cell(board, fr+dr*d, fc+dc*d) !== 1) break; right++ }
      const run = left + right + 1
      const lOpen = cell(board, fr-(left+1)*dr, fc-(left+1)*dc) === 0
      const rOpen = cell(board, fr+(right+1)*dr, fc+(right+1)*dc) === 0
      board[fr][fc] = 0

      if (run !== 4 || !lOpen || !rOpen) continue

      // 거짓금수: 채우는 자리가 흑 입장에서 금수면 진짜 삼이 아님
      if (depth < 2 && checkForbidden(board, fr, fc, depth + 1) !== null) continue

      return true
    }
  }
  return false
}

module.exports = { checkForbidden }
