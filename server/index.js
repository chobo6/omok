const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { createBoard, checkWin, isBoardFull } = require('./gameLogic')
const { checkForbidden } = require('./forbidden')
const { getProfile, applyResult, getLeaderboard } = require('./ratings')

const app = express()
app.use(cors())

// ─── REST ────────────────────────────────────────────────────────────────────

app.get('/api/rooms', (req, res) => {
  const list = []
  for (const [roomId, room] of rooms.entries()) {
    if (room.type === 'public' && room.status === 'waiting') {
      list.push({
        roomId,
        host: room.nicknames[room.players[0]] || '호스트',
        playerCount: room.players.length,
      })
    }
  }
  res.json(list)
})

app.get('/api/leaderboard', (req, res) => {
  res.json(getLeaderboard(20))
})

// ─── Socket.io ───────────────────────────────────────────────────────────────

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

// roomId → { board, players, nicknames, currentTurn, status, lastMove, chat,
//             timers, timerInterval, type, userIds, initialRatings,
//             pendingUsers(ranked_pending only), rematchVotes }
const rooms = new Map()
const rankedQueue = []  // [{ socketId, userId, nickname, rating }]

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
      rating: room.initialRatings?.[id] ?? null,
    })),
    currentTurn: room.currentTurn,
    status: room.status,
    lastMove: room.lastMove,
    roomType: room.type,
  })
}

function startTimer(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  clearInterval(room.timerInterval)

  room.timerInterval = setInterval(() => {
    const r = rooms.get(roomId)
    if (!r || r.status !== 'playing') { clearInterval(r?.timerInterval); return }

    const currentId = r.players[r.currentTurn - 1]
    r.timers[currentId] = Math.max(0, r.timers[currentId] - 1)
    io.to(roomId).emit('timer:tick', { socketId: currentId, timeLeft: r.timers[currentId] })

    if (r.timers[currentId] <= 0) {
      clearInterval(r.timerInterval)
      r.status = 'ended'
      const winnerIdx = r.currentTurn === 1 ? 1 : 0
      const winnerId = r.players[winnerIdx]
      emitRoomState(roomId)
      io.to(roomId).emit('game:over', { winner: winnerIdx + 1, winnerId, reason: 'timeout' })
      applyRankedRating(roomId, winnerIdx + 1)
    }
  }, 1000)
}

function applyRankedRating(roomId, winnerNumber) {
  const room = rooms.get(roomId)
  if (!room || room.type !== 'ranked' || room.players.length < 2) return
  const [p1, p2] = room.players
  const uid1 = room.userIds?.[p1]
  const uid2 = room.userIds?.[p2]
  if (!uid1 || !uid2) return
  const score = winnerNumber === 1 ? 1 : winnerNumber === 2 ? 0 : 0.5
  const result = applyResult(uid1, uid2, score)
  io.to(p1).emit('rating:update', { delta: result.deltaA, newRating: result.ratingA })
  io.to(p2).emit('rating:update', { delta: result.deltaB, newRating: result.ratingB })
}

// ─── 이벤트 핸들러 ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const { userId } = socket.handshake.auth
  console.log('connected:', socket.id)

  // ── 방 만들기 (비공개 / 공개) ────────────────────────────────────────────
  socket.on('room:create', ({ nickname, type = 'private' }) => {
    const roomId = generateRoomId()
    const profile = userId ? getProfile(userId, nickname) : null
    rooms.set(roomId, {
      board: createBoard(),
      players: [socket.id],
      nicknames: { [socket.id]: nickname || '플레이어1' },
      currentTurn: 1,
      status: 'waiting',
      lastMove: null,
      chat: [],
      timers: { [socket.id]: 180 },
      timerInterval: null,
      type,
      userIds: { [socket.id]: userId },
      initialRatings: { [socket.id]: profile?.rating ?? null },
    })
    socket.join(roomId)
    socket.emit('room:created', { roomId })
    emitRoomState(roomId)
  })

  // ── 방 입장 (코드 / 공개방 목록) ─────────────────────────────────────────
  socket.on('room:join', ({ roomId, nickname }) => {
    const room = rooms.get(roomId)
    if (!room) { socket.emit('room:error', { message: '방을 찾을 수 없습니다.' }); return }
    if (room.players.length >= 2) { socket.emit('room:error', { message: '방이 가득 찼습니다.' }); return }
    if (room.status !== 'waiting') { socket.emit('room:error', { message: '이미 게임이 시작된 방입니다.' }); return }

    const profile = userId ? getProfile(userId, nickname) : null
    room.players.push(socket.id)
    room.nicknames[socket.id] = nickname || '플레이어2'
    room.timers[socket.id] = 180
    room.userIds ??= {}
    room.userIds[socket.id] = userId
    room.initialRatings ??= {}
    room.initialRatings[socket.id] = profile?.rating ?? null
    room.status = 'playing'
    socket.join(roomId)
    io.to(roomId).emit('room:joined', { roomId })
    startTimer(roomId)
    emitRoomState(roomId)
  })

  // ── 랭킹전 대기열 참가 ───────────────────────────────────────────────────
  socket.on('ranked:queue:join', ({ nickname }) => {
    if (!userId) { socket.emit('room:error', { message: '사용자 정보가 없습니다.' }); return }

    const nick = nickname || '플레이어'
    const profile = getProfile(userId, nick)

    // 중복 제거
    const dup = rankedQueue.findIndex(q => q.userId === userId || q.socketId === socket.id)
    if (dup !== -1) rankedQueue.splice(dup, 1)

    if (rankedQueue.length > 0) {
      const opp = rankedQueue.shift()
      const roomId = generateRoomId()
      rooms.set(roomId, {
        board: createBoard(),
        players: [],
        nicknames: {},
        currentTurn: 1,
        status: 'ranked_pending',
        lastMove: null,
        chat: [],
        timers: {},
        timerInterval: null,
        type: 'ranked',
        userIds: {},
        initialRatings: {},
        pendingUsers: [
          { userId: opp.userId,  nickname: opp.nickname,  rating: opp.rating },
          { userId,              nickname: nick,           rating: profile.rating },
        ],
      })
      // 30초 미참가 시 방 정리
      setTimeout(() => {
        if (rooms.get(roomId)?.status === 'ranked_pending') rooms.delete(roomId)
      }, 30000)
      io.to(opp.socketId).emit('ranked:match:found', { roomId })
      socket.emit('ranked:match:found', { roomId })
    } else {
      rankedQueue.push({ socketId: socket.id, userId, nickname: nick, rating: profile.rating })
      socket.emit('ranked:queue:status', { position: rankedQueue.length })
    }
  })

  // ── 랭킹전 대기열 취소 ───────────────────────────────────────────────────
  socket.on('ranked:queue:leave', () => {
    const idx = rankedQueue.findIndex(q => q.socketId === socket.id)
    if (idx !== -1) rankedQueue.splice(idx, 1)
  })

  // ── 랭킹전 게임 소켓으로 방 참가 ─────────────────────────────────────────
  socket.on('ranked:join', ({ roomId }) => {
    if (!userId) { socket.emit('room:error', { message: '사용자 정보가 없습니다.' }); return }
    const room = rooms.get(roomId)
    if (!room || room.type !== 'ranked' || room.status !== 'ranked_pending') {
      socket.emit('room:error', { message: '매칭 정보를 찾을 수 없습니다.' }); return
    }
    const pending = room.pendingUsers?.find(p => p.userId === userId)
    if (!pending) { socket.emit('room:error', { message: '참가 권한이 없습니다.' }); return }

    room.players.push(socket.id)
    room.nicknames[socket.id] = pending.nickname
    room.timers[socket.id] = 180
    room.userIds[socket.id] = userId
    room.initialRatings[socket.id] = pending.rating
    room.pendingUsers = room.pendingUsers.filter(p => p.userId !== userId)

    socket.join(roomId)
    socket.emit('room:joined', { roomId })

    if (room.pendingUsers.length === 0) {
      // 양쪽 모두 참가 → 게임 시작
      room.status = 'playing'
      startTimer(roomId)
      emitRoomState(roomId)
    }
  })

  // ── 프로필 조회 ──────────────────────────────────────────────────────────
  socket.on('profile:get', () => {
    if (!userId) return
    socket.emit('profile:data', getProfile(userId))
  })

  // ── 돌 놓기 ──────────────────────────────────────────────────────────────
  socket.on('game:move', ({ row, col }) => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found
    if (room.status !== 'playing') return
    const playerIndex = room.players.indexOf(socket.id)
    const playerNumber = playerIndex + 1
    if (playerNumber !== room.currentTurn) return
    if (room.board[row][col] !== 0) return

    if (playerNumber === 1) {
      const forbidden = checkForbidden(room.board, row, col)
      if (forbidden) {
        room.board[row][col] = 1
        room.lastMove = { row, col, player: 1 }
        clearInterval(room.timerInterval)
        room.status = 'ended'
        emitRoomState(roomId)
        io.to(roomId).emit('game:over', {
          winner: 2, winnerId: room.players[1],
          reason: 'forbidden', forbiddenType: forbidden, forbiddenMove: { row, col },
        })
        applyRankedRating(roomId, 2)
        return
      }
    }

    room.board[row][col] = playerNumber
    room.lastMove = { row, col, player: playerNumber }

    if (checkWin(room.board, row, col, playerNumber)) {
      clearInterval(room.timerInterval)
      room.status = 'ended'
      emitRoomState(roomId)
      io.to(roomId).emit('game:over', { winner: playerNumber, winnerId: socket.id, reason: 'win', winMove: { row, col } })
      applyRankedRating(roomId, playerNumber)
      return
    }
    if (isBoardFull(room.board)) {
      clearInterval(room.timerInterval)
      room.status = 'ended'
      emitRoomState(roomId)
      io.to(roomId).emit('game:over', { winner: 0, reason: 'draw' })
      applyRankedRating(roomId, 0)
      return
    }

    room.currentTurn = playerNumber === 1 ? 2 : 1
    room.timers[room.players[room.currentTurn - 1]] = 180
    startTimer(roomId)
    emitRoomState(roomId)
  })

  // ── 재경기 ───────────────────────────────────────────────────────────────
  socket.on('game:rematch', () => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found
    if (room.type === 'ranked') {
      socket.emit('room:error', { message: '랭킹전은 재경기가 불가합니다. 대기열에 다시 참가해주세요.' })
      return
    }
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

  // ── 채팅 ─────────────────────────────────────────────────────────────────
  socket.on('chat:send', ({ message }) => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found
    const msg = { nickname: room.nicknames[socket.id] || '?', message, time: Date.now() }
    room.chat.push(msg)
    if (room.chat.length > 100) room.chat.shift()
    io.to(roomId).emit('chat:message', msg)
  })

  // ── 항복 ─────────────────────────────────────────────────────────────────
  socket.on('game:surrender', () => {
    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found
    if (room.status !== 'playing') return
    clearInterval(room.timerInterval)
    room.status = 'ended'
    const loserIdx = room.players.indexOf(socket.id)
    const winnerIdx = loserIdx === 0 ? 1 : 0
    const winnerId = room.players[winnerIdx]
    emitRoomState(roomId)
    io.to(roomId).emit('game:over', { winner: winnerIdx + 1, winnerId, reason: 'surrender' })
    applyRankedRating(roomId, winnerIdx + 1)
  })

  // ── 연결 끊김 ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id)
    const qi = rankedQueue.findIndex(q => q.socketId === socket.id)
    if (qi !== -1) rankedQueue.splice(qi, 1)

    const found = getRoomBySocket(socket.id)
    if (!found) return
    const { roomId, room } = found
    clearInterval(room.timerInterval)

    if (room.status === 'ranked_pending') {
      room.players.forEach(pid => {
        if (pid !== socket.id) io.to(pid).emit('room:error', { message: '상대 연결이 끊겼습니다.' })
      })
      rooms.delete(roomId)
      return
    }
    if (room.status === 'playing') {
      room.status = 'ended'
      const remaining = room.players.find(id => id !== socket.id)
      const winnerNumber = remaining ? room.players.indexOf(remaining) + 1 : 0
      if (remaining) {
        io.to(roomId).emit('game:over', { winner: winnerNumber, winnerId: remaining, reason: 'disconnect' })
        applyRankedRating(roomId, winnerNumber)
      }
    }
    rooms.delete(roomId)
  })
})

const PORT = 4000
server.listen(PORT, () => console.log(`오목 서버 실행 중: http://localhost:${PORT}`))
