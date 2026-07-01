import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { io } from 'socket.io-client'
import Board from '../components/Board'
import Chat from '../components/Chat'
import PlayerInfo from '../components/PlayerInfo'
import { getForbiddenCells } from '../utils/forbidden'
import styles from './Game.module.css'

const BOARD_SIZE = 15

function createBoard() {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0))
}

export default function Game({ config, onLeave }) {
  const { mode, nickname, action, roomCode } = config
  const isOnline = mode === 'online'

  // 공통 상태
  const [board, setBoard] = useState(createBoard())
  const [currentTurn, setCurrentTurn] = useState(1)  // 1=흑, 2=백
  const [status, setStatus] = useState(isOnline ? 'waiting' : 'playing')
  const [lastMove, setLastMove] = useState(null)
  const [gameOver, setGameOver] = useState(null)  // { winner, reason }
  const [messages, setMessages] = useState([])
  const [roomId, setRoomId] = useState('')
  const [players, setPlayers] = useState([])
  const [myColor, setMyColor] = useState(null)  // 'black' | 'white'
  const [copied, setCopied] = useState(false)
  const [rematchRequested, setRematchRequested] = useState(false)

  // AI 모드 타이머
  const [timers, setTimers] = useState({ 1: 180, 2: 180 })
  const timerRef = useRef(null)

  const socketRef = useRef(null)
  const aiWorkerRef = useRef(null)
  const boardRef = useRef(board)
  const turnRef = useRef(currentTurn)
  const playersRef = useRef([])
  const forbiddenCellsRef = useRef([])

  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => { turnRef.current = currentTurn }, [currentTurn])
  useEffect(() => { playersRef.current = players }, [players])

  // ─── 온라인 모드 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOnline) return

    const socket = io('/', { path: '/socket.io' })
    socketRef.current = socket

    socket.on('connect', () => {
      if (action === 'create') {
        socket.emit('room:create', { nickname })
      } else {
        socket.emit('room:join', { roomId: roomCode, nickname })
      }
    })

    socket.on('room:created', ({ roomId }) => {
      setRoomId(roomId)
    })

    socket.on('room:joined', ({ roomId }) => {
      setRoomId(roomId)
    })

    socket.on('room:error', ({ message }) => {
      alert(message)
      onLeave()
    })

    socket.on('room:state', (state) => {
      const newBoard = state.board.map(row => [...row])
      setBoard(newBoard)
      boardRef.current = newBoard
      setCurrentTurn(state.currentTurn)
      turnRef.current = state.currentTurn
      setStatus(state.status)
      setLastMove(state.lastMove)
      setPlayers(state.players)

      // 내 색상 결정
      const myIdx = state.players.findIndex(p => p.id === socket.id)
      if (myIdx !== -1) setMyColor(state.players[myIdx].color)

      // 타이머 동기화
      const newTimers = {}
      state.players.forEach(p => { newTimers[p.color === 'black' ? 1 : 2] = p.timeLeft })
      setTimers(newTimers)
    })

    socket.on('timer:tick', ({ socketId, timeLeft }) => {
      const player = playersRef.current.find(p => p.id === socketId)
      if (!player) return
      setTimers(prev => ({
        ...prev,
        [player.color === 'black' ? 1 : 2]: timeLeft
      }))
    })

    socket.on('game:over', (data) => {
      setGameOver(data)
      setStatus('ended')
    })

    socket.on('game:restarted', () => {
      setGameOver(null)
      setRematchRequested(false)
    })

    socket.on('game:rematch_requested', () => {
      setRematchRequested(true)
    })

    socket.on('chat:message', (msg) => {
      setMessages(prev => [...prev, msg])
    })

    return () => socket.disconnect()
  }, [isOnline])

  // ─── AI 모드 타이머 ─────────────────────────────────────────────
  useEffect(() => {
    if (isOnline || status !== 'playing') return

    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimers(prev => {
        const curr = turnRef.current
        const newTime = Math.max(0, prev[curr] - 1)
        if (newTime <= 0) {
          clearInterval(timerRef.current)
          setGameOver({ winner: curr === 1 ? 2 : 1, reason: 'timeout' })
          setStatus('ended')
        }
        return { ...prev, [curr]: newTime }
      })
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [currentTurn, status, isOnline])

  // AI 연산(Minimax/VCF)은 메인 스레드를 막지 않도록 Web Worker에서 실행
  useEffect(() => {
    if (isOnline) return

    aiWorkerRef.current = new Worker(new URL('../utils/aiWorker.js', import.meta.url), { type: 'module' })
    return () => aiWorkerRef.current?.terminate()
  }, [isOnline])

  // ─── AI 착수 ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOnline || status !== 'playing' || currentTurn !== 2) return

    const worker = aiWorkerRef.current
    if (!worker) return

    let cancelled = false

    const timeout = setTimeout(() => {
      const b = boardRef.current.map(row => [...row])

      const handleMessage = (e) => {
        worker.removeEventListener('message', handleMessage)
        if (cancelled) return
        const move = e.data
        if (move) handleLocalMove(move.row, move.col, b)
      }

      worker.addEventListener('message', handleMessage)
      worker.postMessage({ board: b, aiPlayer: 2 })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [currentTurn, status, isOnline])

  // ─── 돌 놓기 ────────────────────────────────────────────────────
  function handleLocalMove(row, col, currentBoard) {
    const b = currentBoard || boardRef.current.map(r => [...r])
    if (b[row][col] !== 0) return

    const player = turnRef.current
    b[row][col] = player
    setBoard(b.map(r => [...r]))
    setLastMove({ row, col, player })

    if (checkWin(b, row, col, player)) {
      clearInterval(timerRef.current)
      setGameOver({ winner: player, reason: 'win', winMove: { row, col } })
      setStatus('ended')
      setTimers(prev => ({ ...prev, [player]: prev[player] }))
      return
    }

    if (b.every(row => row.every(c => c !== 0))) {
      clearInterval(timerRef.current)
      setGameOver({ winner: 0, reason: 'draw' })
      setStatus('ended')
      return
    }

    const next = player === 1 ? 2 : 1
    setCurrentTurn(next)
    setTimers(prev => ({ ...prev, [next]: 180 }))
  }

  function checkWin(board, row, col, player) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]]
    for (const [dr, dc] of dirs) {
      let count = 1
      for (let d = 1; d <= 4; d++) {
        const r = row+dr*d, c = col+dc*d
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE||board[r][c]!==player) break
        count++
      }
      for (let d = 1; d <= 4; d++) {
        const r = row-dr*d, c = col-dc*d
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE||board[r][c]!==player) break
        count++
      }
      if (count >= 5) return true
    }
    return false
  }

  function onBoardClick(row, col) {
    if (status !== 'playing' || gameOver) return

    if (isOnline) {
      const myTurn = myColor === 'black' ? 1 : 2
      if (currentTurn !== myTurn) return
      // 서버가 금수 판정 후 game:over 처리
      socketRef.current?.emit('game:move', { row, col })
    } else {
      if (currentTurn !== 1) return  // AI 착수 중 클릭 방지

      // ref로 항상 최신 forbiddenCells 참조 (클로저 stale 방지)
      const forbiddenHit = forbiddenCellsRef.current.find(f => f.row === row && f.col === col)
      if (forbiddenHit) {
        const b = board.map(r => [...r])
        b[row][col] = 1
        setBoard(b)
        setLastMove({ row, col, player: 1 })
        clearInterval(timerRef.current)
        setStatus('ended')
        setGameOver({ winner: 2, reason: 'forbidden', forbiddenType: forbiddenHit.type, forbiddenMove: { row, col } })
        return
      }

      handleLocalMove(row, col)
    }
  }

  function handleSurrender() {
    if (!isOnline || status !== 'playing') return
    if (window.confirm('정말 항복하시겠습니까?')) {
      socketRef.current?.emit('game:surrender')
    }
  }

  function handleRematch() {
    if (isOnline) {
      socketRef.current?.emit('game:rematch')
    } else {
      setBoard(createBoard())
      setCurrentTurn(1)
      setStatus('playing')
      setLastMove(null)
      setGameOver(null)
      setTimers({ 1: 180, 2: 180 })
    }
  }

  function handleChatSend(message) {
    if (isOnline) {
      socketRef.current?.emit('chat:send', { message })
    } else {
      setMessages(prev => [...prev, { nickname, message, time: Date.now() }])
    }
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(roomId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 내 턴 여부
  const isMyTurn = isOnline
    ? myColor === 'black' ? currentTurn === 1 : currentTurn === 2
    : currentTurn === 1

  // 보드 클릭 비활성화 조건
  const boardDisabled = status !== 'playing' || !!gameOver || (isOnline && !isMyTurn) || (!isOnline && currentTurn === 2)

  // 흑 차례일 때만 금수 위치 계산 (시각화)
  const forbiddenCells = useMemo(() => {
    const isBlackTurn = isOnline ? currentTurn === 1 && myColor === 'black' : currentTurn === 1
    if (status !== 'playing' || !isBlackTurn) return []
    return getForbiddenCells(board.map(r => [...r]))
  }, [board, currentTurn, status, isOnline, myColor])

  // 항상 최신 금수 목록을 ref에 동기화
  forbiddenCellsRef.current = forbiddenCells

  // 표시용 플레이어 정보 (AI 모드)
  const aiPlayers = [
    { id: '1', color: 'black', nickname: nickname || '나', timeLeft: timers[1] },
    { id: '2', color: 'white', nickname: 'AI', timeLeft: timers[2] },
  ]

  // 온라인 모드: timers state(매초 timer:tick으로 갱신)를 timeLeft에 합성
  // players.timeLeft는 착수 시점의 값이라 실시간 반영이 안 됨
  const displayPlayers = isOnline
    ? players.map(p => ({ ...p, timeLeft: timers[p.color === 'black' ? 1 : 2] ?? p.timeLeft }))
    : aiPlayers

  return (
    <div className={styles.container}>
      {/* 방 코드 배너 */}
      {isOnline && status === 'waiting' && (
        <div className={styles.waitingBanner}>
          <span>친구를 기다리는 중...</span>
          <div className={styles.roomCode}>
            방 코드: <strong>{roomId}</strong>
            <button className={styles.copyBtn} onClick={copyRoomCode}>
              {copied ? '복사됨!' : '복사'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.layout}>
        {/* 좌측: 플레이어 정보 + 보드 */}
        <div className={styles.leftPanel}>
          <div className={styles.playerRow}>
            {displayPlayers.map((p, i) => (
              <PlayerInfo
                key={p.id}
                player={p}
                isMyTurn={currentTurn === (p.color === 'black' ? 1 : 2)}
                timeLeft={p.timeLeft}
              />
            ))}
          </div>

          <Board
            board={board}
            onMove={onBoardClick}
            lastMove={lastMove}
            disabled={boardDisabled}
            myColor={isOnline ? myColor : 'black'}
            forbiddenCells={forbiddenCells}
          />

          <div className={styles.actions}>
            {status === 'playing' && isOnline && (
              <button className={styles.surrenderBtn} onClick={handleSurrender}>항복</button>
            )}
            <button className={styles.leaveBtn} onClick={onLeave}>나가기</button>
          </div>
        </div>

        {/* 우측: 채팅 */}
        <div className={styles.rightPanel}>
          <Chat messages={messages} onSend={handleChatSend} />
        </div>
      </div>

      {/* 게임 종료 모달 */}
      {gameOver && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>
              {gameOver.reason === 'draw' ? '무승부!' :
               gameOver.reason === 'disconnect' ? '상대방이 나갔습니다' :
               gameOver.reason === 'timeout' ? '시간 초과!' :
               gameOver.reason === 'surrender' ? '항복!' :
               gameOver.reason === 'forbidden' ? `금수 (${gameOver.forbiddenType})` : '게임 종료!'}
            </div>
            <div className={styles.modalResult}>
              {gameOver.winner === 0 ? '비겼습니다' :
               isOnline
                 ? (gameOver.winnerId === socketRef.current?.id ? '승리했습니다! 🎉' : '패배했습니다')
                 : (gameOver.winner === 1 ? '승리했습니다! 🎉' : 'AI가 이겼습니다')}
            </div>
            {rematchRequested && <div className={styles.rematchInfo}>상대방이 재경기를 요청했습니다</div>}
            <div className={styles.modalActions}>
              <button className={styles.rematchBtn} onClick={handleRematch}>
                {isOnline ? '재경기 요청' : '다시하기'}
              </button>
              <button className={styles.leaveBtn} onClick={onLeave}>나가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
