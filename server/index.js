const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { createBoard, checkWin, isBoardFull } = require('./gameLogic')

const app = express()
app.use(cors())

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

// roomId -> { board, players: [socketId, socketId], currentTurn: 1|2, status, chat, timers }
const rooms = new Map()

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function getRoomBySocket(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.includes(socketId)) return { roomId, room }
  }
  return null
}

function emitRoomState(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('room:state', {
    board: room.board,
    players: room.players.map((id, i) => ({
      id,
      color: i === 0 ? 'black' : 'white',
      nickname: room.nicknames[id] || `플레이어${i + 1}`,
      timeLeft: room.timers[id],
    })),
    currentTurn: room.currentTurn,
    status: room.status,
    lastMove: room.lastMove,
  })
}

function startTimer(roomId) {
  const room = rooms.get(roomId)
  if (!room) return

  clearInterval(room.timerInterval)

  room.timerInterval = setInterval(() => {
    const r = rooms.get(roomId)
    if (!r || r.status !== 'playing') {
      clearInterval(r?.timerInterval)
      return
    }

    const currentSocketId = r.players[r.currentTurn - 1]
    r.timers[currentSocketId] = Math.max(0, r.timers[currentSocketId] - 1)

    io.to(roomId).emit('timer:tick', {
      socketId: currentSocketId,
      timeLeft: r.timers[currentSocketId],
    })

    if (r.timers[currentSocketId] <= 0) {
      clearInterval(r.timerInterval)
      r.status = 'ended'
      const winnerIndex = r.currentTurn === 1 ? 1 : 0
      const winnerId = r.players[winnerIndex]
      io.to(roomId).emit('game:over', {
        winner: winnerIndex + 1,
        winnerId,
        reason: 'timeout',
      })
    }
  }, 1000)
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id)

  // 방 만들기
  socket.on('room:create', ({ nickname }) => {
    const roomId = generateRoomId()
    const board = createBoard()
    rooms.set(roomId, {
      board,
      players: [socket.id],
      nicknames: { [socket.id]: nickname || '플레이어1' },
      currentTurn: 1,
      status: 'waiting',
      lastMove: null,
      chat: [],
      timers: { [socket.id]: 180 },
      timerInterval: null,
    })
    socket.join(roomId)
    socket.emit('room:created', { roomId })
    emitRoomState(roomId)
  })

  // 방 입장
  socket.on('room:join', ({ roomId, nickname }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room:error', { message: '방을 찾을 수 없습니다.' })
      return
    }
    if (room.players.length >= 2) {
      socket.emit('room:error', { message: '방이 가득 찼습니다.' })
      return
    }
    if (room.status !== 'waiting') {
      socket.emit('room:error', { message: '이미 게임이 시작된 방입니다.' })
      return
    }

    room.players.push(socket.id)
    room.nicknames[socket.id] = nickname || '플레이어2'
    room.timers[socket.id] = 180
    room.status = 'playing'
    socket.join(roomId)

    io.to(roomId).emit('room:joined', { roomId })
    startTimer(roomId)
    emitRoomState(roomId)
  })

  // 돌 놓기
  socket.on('game:move', ({ row, col }) => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found

    if (room.status !== 'playing') return

    const playerIndex = room.players.indexOf(socket.id)
    const playerNumber = playerIndex + 1
    if (playerNumber !== room.currentTurn) return
    if (room.board[row][col] !== 0) return

    room.board[row][col] = playerNumber
    room.lastMove = { row, col, player: playerNumber }

    if (checkWin(room.board, row, col, playerNumber)) {
      clearInterval(room.timerInterval)
      room.status = 'ended'
      emitRoomState(roomId)
      io.to(roomId).emit('game:over', {
        winner: playerNumber,
        winnerId: socket.id,
        reason: 'win',
        winMove: { row, col },
      })
      return
    }

    if (isBoardFull(room.board)) {
      clearInterval(room.timerInterval)
      room.status = 'ended'
      emitRoomState(roomId)
      io.to(roomId).emit('game:over', { winner: 0, reason: 'draw' })
      return
    }

    room.currentTurn = playerNumber === 1 ? 2 : 1
    // 다음 플레이어 타이머 초기화
    const nextId = room.players[room.currentTurn - 1]
    room.timers[nextId] = 180
    startTimer(roomId)
    emitRoomState(roomId)
  })

  // 재경기 요청
  socket.on('game:rematch', () => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found

    if (!room.rematchVotes) room.rematchVotes = new Set()
    room.rematchVotes.add(socket.id)

    if (room.rematchVotes.size === 2) {
      room.board = createBoard()
      room.currentTurn = 1
      room.status = 'playing'
      room.lastMove = null
      room.rematchVotes = new Set()
      room.players.forEach(id => { room.timers[id] = 180 })
      startTimer(roomId)
      io.to(roomId).emit('game:restarted')
      emitRoomState(roomId)
    } else {
      io.to(roomId).emit('game:rematch_requested', { by: socket.id })
    }
  })

  // 채팅
  socket.on('chat:send', ({ message }) => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found

    const nickname = room.nicknames[socket.id] || '알 수 없음'
    const msg = { nickname, message, time: Date.now() }
    room.chat.push(msg)
    if (room.chat.length > 100) room.chat.shift()

    io.to(roomId).emit('chat:message', msg)
  })

  // 항복
  socket.on('game:surrender', () => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found

    if (room.status !== 'playing') return
    clearInterval(room.timerInterval)
    room.status = 'ended'

    const loserIndex = room.players.indexOf(socket.id)
    const winnerIndex = loserIndex === 0 ? 1 : 0
    const winnerId = room.players[winnerIndex]

    emitRoomState(roomId)
    io.to(roomId).emit('game:over', {
      winner: winnerIndex + 1,
      winnerId,
      reason: 'surrender',
    })
  })

  // 연결 끊김
  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id)
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found

    clearInterval(room.timerInterval)

    if (room.status === 'playing') {
      room.status = 'ended'
      const remainingPlayer = room.players.find(id => id !== socket.id)
      if (remainingPlayer) {
        io.to(roomId).emit('game:over', {
          winner: room.players.indexOf(remainingPlayer) + 1,
          winnerId: remainingPlayer,
          reason: 'disconnect',
        })
      }
    }

    rooms.delete(roomId)
  })
})

const PORT = 4000
server.listen(PORT, () => {
  console.log(`오목 서버 실행 중: http://localhost:${PORT}`)
})
