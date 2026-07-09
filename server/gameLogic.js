const BOARD_SIZE = 15

function createBoard() {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0))
}

// 승리 시 완성된 연속 돌들의 좌표 배열(길이 5 이상, 백은 장목도 승리라 6개 이상일 수 있음)을 반환, 아니면 null
function checkWin(board, row, col, player) {
  const directions = [
    [0, 1],   // 가로
    [1, 0],   // 세로
    [1, 1],   // 대각선 ↘
    [1, -1],  // 대각선 ↙
  ]

  for (const [dr, dc] of directions) {
    const line = [{ row, col }]

    for (let d = 1; d <= 4; d++) {
      const r = row + dr * d
      const c = col + dc * d
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (board[r][c] !== player) break
      line.push({ row: r, col: c })
    }
    for (let d = 1; d <= 4; d++) {
      const r = row - dr * d
      const c = col - dc * d
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (board[r][c] !== player) break
      line.unshift({ row: r, col: c })
    }

    if (line.length >= 5) return line
  }
  return null
}

function isBoardFull(board) {
  return board.every(row => row.every(cell => cell !== 0))
}

module.exports = { createBoard, checkWin, isBoardFull, BOARD_SIZE }
