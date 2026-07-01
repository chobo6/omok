import { useRef, useEffect } from 'react'
import styles from './Board.module.css'

const BOARD_SIZE = 15
const CELL_SIZE = 40

export default function Board({ board, onMove, lastMove, disabled, myColor }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    drawBoard()
  }, [board, lastMove])

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
      ctx.strokeStyle = lastMove.player === 1 ? '#ff4444' : '#4488ff'
      ctx.lineWidth = 2
      const cx = padding + col * CELL_SIZE
      const cy = padding + row * CELL_SIZE
      ctx.strokeRect(cx - 6, cy - 6, 12, 12)
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
