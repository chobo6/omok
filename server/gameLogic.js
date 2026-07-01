const BOARD_SIZE = 15

function createBoard() {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0))
}

function checkWin(board, row, col, player) {
  const directions = [
    [0, 1],   // 가로
    [1, 0],   // 세로
    [1, 1],   // 대각선 ↘
    [1, -1],  // 대각선 ↙
  ]

  for (const [dr, dc] of directions) {
    let count = 1

    for (let d = 1; d <= 4; d++) {
      const r = row + dr * d
      const c = col + dc * d
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (board[r][c] !== player) break
      count++
    }
    for (let d = 1; d <= 4; d++) {
      const r = row - dr * d
      const c = col - dc * d
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (board[r][c] !== player) break
      count++
    }

    if (count >= 5) return true
  }
  return false
}

function isBoardFull(board) {
  return board.every(row => row.every(cell => cell !== 0))
}

module.exports = { createBoard, checkWin, isBoardFull, BOARD_SIZE }
