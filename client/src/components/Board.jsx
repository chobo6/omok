import { useRef, useEffect } from 'react'
import styles from './Board.module.css'

const BOARD_SIZE = 15
const CELL_SIZE = 40

// forbiddenCells: [{ row, col, type }]
// winLine: [{ row, col }] — 승리로 이어진 연속된 돌들의 좌표(있으면 하이라이트)
export default function Board({ board, onMove, lastMove, disabled, myColor, forbiddenCells = [], winLine = [] }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    drawBoard()
  }, [board, lastMove, forbiddenCells, winLine])

  function drawBoard() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const size = CELL_SIZE * (BOARD_SIZE - 1)
    const padding = CELL_SIZE

    canvas.width = size + padding * 2
    canvas.height = size + padding * 2

    // 배경
    ctx.fillStyle = '#dcb67a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 격자선
    ctx.strokeStyle = '#8b6914'
    ctx.lineWidth = 1
    for (let i = 0; i < BOARD_SIZE; i++) {
      const x = padding + i * CELL_SIZE
      const y = padding + i * CELL_SIZE

      ctx.beginPath()
      ctx.moveTo(x, padding)
      ctx.lineTo(x, padding + (BOARD_SIZE - 1) * CELL_SIZE)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(padding, y)
      ctx.lineTo(padding + (BOARD_SIZE - 1) * CELL_SIZE, y)
      ctx.stroke()
    }

    // 화점 (천원, 성 등)
    const starPoints = [3, 7, 11]
    ctx.fillStyle = '#8b6914'
    for (const r of starPoints) {
      for (const c of starPoints) {
        ctx.beginPath()
        ctx.arc(padding + c * CELL_SIZE, padding + r * CELL_SIZE, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 돌 그리기
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === 0) continue
        drawStone(ctx, padding + c * CELL_SIZE, padding + r * CELL_SIZE, board[r][c])
      }
    }

    // 마지막 수 표시
    if (lastMove) {
      const { row, col } = lastMove
      ctx.strokeStyle = lastMove.player === 1 ? '#9c3b2e' : '#5f8770'
      ctx.lineWidth = 2
      const cx = padding + col * CELL_SIZE
      const cy = padding + row * CELL_SIZE
      ctx.strokeRect(cx - 6, cy - 6, 12, 12)
    }

    // 승리한 5목 라인 표시 — 이어진 돌을 잇는 굵은 선 + 각 돌 주위 골드 링
    if (winLine.length >= 2) {
      const first = winLine[0]
      const last = winLine[winLine.length - 1]

      ctx.strokeStyle = 'rgba(212, 160, 23, 0.9)'
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(padding + first.col * CELL_SIZE, padding + first.row * CELL_SIZE)
      ctx.lineTo(padding + last.col * CELL_SIZE, padding + last.row * CELL_SIZE)
      ctx.stroke()

      for (const { row, col } of winLine) {
        const cx = padding + col * CELL_SIZE
        const cy = padding + row * CELL_SIZE
        ctx.strokeStyle = '#d4a017'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cx, cy, CELL_SIZE * 0.44 + 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // 금수 위치 표시 (렌주 삼각형 기호)
    for (const { row, col } of forbiddenCells) {
      const cx = padding + col * CELL_SIZE
      const cy = padding + row * CELL_SIZE
      const s = CELL_SIZE * 0.28

      ctx.fillStyle = 'rgba(156, 59, 46, 0.75)'
      ctx.beginPath()
      ctx.moveTo(cx, cy - s)
      ctx.lineTo(cx + s * 0.87, cy + s * 0.5)
      ctx.lineTo(cx - s * 0.87, cy + s * 0.5)
      ctx.closePath()
      ctx.fill()
    }
  }

  function drawStone(ctx, x, y, player) {
    const radius = CELL_SIZE * 0.44

    const gradient = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, radius * 0.1,
      x, y, radius
    )

    if (player === 1) {
      gradient.addColorStop(0, '#555')
      gradient.addColorStop(1, '#000')
    } else {
      gradient.addColorStop(0, '#fff')
      gradient.addColorStop(1, '#ccc')
    }

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()

    ctx.strokeStyle = player === 1 ? '#333' : '#aaa'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  function handleClick(e) {
    if (disabled) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    const padding = CELL_SIZE
    const col = Math.round((x - padding) / CELL_SIZE)
    const row = Math.round((y - padding) / CELL_SIZE)

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return
    if (board[row][col] !== 0) return

    onMove(row, col)
  }

  return (
    <div className={styles.boardWrapper}>
      <canvas
        ref={canvasRef}
        className={`${styles.canvas} ${disabled ? styles.disabled : ''}`}
        onClick={handleClick}
      />
    </div>
  )
}
