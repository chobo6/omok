const BOARD_SIZE = 15
const DIRS = [[0,1],[1,0],[1,1],[1,-1]]

function cell(board, r, c) {
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return -1
  return board[r][c]
}

export function checkForbidden(board, row, col, depth = 0) {
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

    board[er][ec] = 1
    let n = 1
    for (let d = 1; d <= 5; d++) { if (cell(board, er+dr*d, ec+dc*d) !== 1) break; n++ }
    for (let d = 1; d <= 5; d++) { if (cell(board, er-dr*d, ec-dc*d) !== 1) break; n++ }
    board[er][ec] = 0

    if (n === 5) return true
  }
  return false
}

function _hasOpenThree(board, row, col, dr, dc, depth) {
  const PATS = [
    [[0,1,1,1,0,0], 4, [1,2,3]],
    [[0,0,1,1,1,0], 1, [2,3,4]],
    [[0,1,0,1,1,0], 2, [1,3,4]],
    [[0,1,1,0,1,0], 3, [1,2,4]],
  ]

  for (let off = 0; off <= 5; off++) {
    const sr = row - off*dr, sc = col - off*dc
    const cells = Array.from({length: 6}, (_, i) => cell(board, sr+i*dr, sc+i*dc))

    for (const [pat, fi, bis] of PATS) {
      if (!cells.every((v, i) => v === pat[i])) continue
      if (!bis.some(i => sr+i*dr === row && sc+i*dc === col)) continue

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

      if (depth < 2 && checkForbidden(board, fr, fc, depth + 1) !== null) continue

      return true
    }
  }
  return false
}

// 현재 보드에서 흑의 모든 금수 위치를 반환 (시각화용)
export function getForbiddenCells(board) {
  const result = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== 0) continue
      const type = checkForbidden(board, r, c)
      if (type) result.push({ row: r, col: c, type })
    }
  }
  return result
}
