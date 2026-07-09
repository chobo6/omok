const BOARD_SIZE = 15
const DIRS = [[0,1],[1,0],[1,1],[1,-1]]

function cell(board, r, c) {
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return -1
  return board[r][c]
}

// 흑(1) 기준 금수 판정. '장목' | '44' | '33' | null 반환
// evaluating: 현재 재귀 평가 중인 위치 키 집합 (순환 참조 방지용)
function checkForbidden(board, row, col, evaluating = new Set()) {
  if (board[row][col] !== 0) return null
  const key = row * BOARD_SIZE + col
  // 이미 평가 중인 지점이 fill 후보로 나오면 금수로 간주 (순환 시 보수적 처리)
  if (evaluating.has(key)) return '33'

  evaluating.add(key)
  board[row][col] = 1
  let result = null

  // 장목(6개 이상)은 방향과 무관하게 항상 금수 — 다른 방향에 정확히 5가 있어도 예외 없음.
  // 오목(정확히 5개, 장목이 아닌 경우)은 다른 방향의 33/44보다 승리가 우선한다.
  const maxRun = _maxRunLength(board, row, col)
  if (maxRun >= 6) {
    result = '장목'
  } else if (maxRun === 5) {
    result = null
  } else {
    let fours = 0
    const fourDirs = new Set()
    for (const [dr, dc] of DIRS) {
      if (_hasFour(board, row, col, dr, dc, evaluating)) { fours++; fourDirs.add(dr + ',' + dc) }
      if (fours >= 2) { result = '44'; break }
    }

    if (!result) {
      let threes = 0
      for (const [dr, dc] of DIRS) {
        // 이미 사(四)로 판정된 방향은 삼 집계에서 제외한다 — 한 방향의 긴 줄이 사(四)의
        // 완성지점과 별개로 더 앞쪽의 다른 빈 칸을 완성지점 삼는 "열린삼" 패턴도 동시에
        // 만족해버려서(같은 돌들을 다르게 잘라 보는 것뿐) 사+삼(4-3, 금수 아님)을
        // 삼+삼(3-3, 금수)으로 잘못 세는 문제가 있었음
        if (fourDirs.has(dr + ',' + dc)) continue
        if (_hasOpenThree(board, row, col, dr, dc, evaluating)) threes++
        if (threes >= 2) { result = '33'; break }
      }
    }
  }

  board[row][col] = 0
  evaluating.delete(key)
  return result
}

// 이 지점을 지나는 4방향 중 가장 긴 연속 흑돌 길이(자기 자신 포함)
function _maxRunLength(board, row, col) {
  let max = 0
  for (const [dr, dc] of DIRS) {
    let n = 1
    for (let d = 1; d <= 5; d++) { if (cell(board, row+dr*d, col+dc*d) !== 1) break; n++ }
    for (let d = 1; d <= 5; d++) { if (cell(board, row-dr*d, col-dc*d) !== 1) break; n++ }
    if (n > max) max = n
  }
  return max
}

// 방향 하나에서 사(四) 여부
function _hasFour(board, row, col, dr, dc, evaluating) {
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

    if (n !== 5) continue

    // 거짓사: 완성 자리가 금수이면 진짜 사가 아님
    if (checkForbidden(board, er, ec, evaluating) !== null) continue

    return true
  }
  return false
}

// 방향 하나에서 열린삼(三) 여부
function _hasOpenThree(board, row, col, dr, dc, evaluating) {
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

      // 거짓금수: 채우는 자리가 금수이면 진짜 삼이 아님
      if (checkForbidden(board, fr, fc, evaluating) !== null) continue

      return true
    }
  }
  return false
}

module.exports = { checkForbidden }
