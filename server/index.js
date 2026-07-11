require('dotenv').config()
const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { createBoard, checkWin, isBoardFull, BOARD_SIZE } = require('./gameLogic')
const { checkForbidden } = require('./forbidden')
const { getProfile, applyResult, getLeaderboard } = require('./ratings')
const { getOrCreateUserId, signSession, verifySession, verifyGoogleIdToken } = require('./googleAuth')
const { recordGame } = require('./games')

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000'
const SESSION_COOKIE = 'omok_session'
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
}

// 부팅 시점에 미리 경고 — 설정이 빠진 채로 두면 로그인 시도 시점에야
// opaque한 401로만 드러나 원인 파악이 어렵다. 인증 미설정이어도 공개방/AI 대전은
// 정상 동작해야 하므로 process.exit()는 하지 않고 warn만 남긴다.
if (!process.env.GOOGLE_CLIENT_ID || !process.env.SESSION_JWT_SECRET) {
  console.warn('⚠️  GOOGLE_CLIENT_ID / SESSION_JWT_SECRET이 설정되지 않았습니다 — Google 로그인이 동작하지 않습니다. server/.env.example 참고.')
}

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(cookieParser())
app.use(express.json())

// ─── REST ────────────────────────────────────────────────────────────────────

app.get('/api/rooms', (req, res) => {
  const list = []
  for (const [roomId, room] of rooms.entries()) {
    // 진행 중(playing)인 방도 목록에 남겨둬서(2/2) 관전 입장이 가능하게 한다 —
    // 종료(ended)된 방은 목록에서 빠짐(재경기 대기 중이라도 새로 관전할 대상은 아님)
    if (room.type === 'public' && (room.status === 'waiting' || room.status === 'playing')) {
      list.push({
        roomId,
        host: room.nicknames[room.players[0]] || '호스트',
        playerCount: room.players.length,
      })
    }
  }
  res.json(list)
})

app.get('/api/leaderboard', async (req, res) => {
  try {
    res.json(await getLeaderboard(20))
  } catch (err) {
    console.error('리더보드 조회 실패:', err)
    res.status(500).json({ message: '리더보드를 불러오지 못했습니다.' })
  }
})

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body
    if (!credential) return res.status(400).json({ message: 'credential이 필요합니다.' })
    const { sub, email, name } = await verifyGoogleIdToken(credential)
    const userId = await getOrCreateUserId(sub, { email, name })
    const token = signSession(userId)
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTIONS)
    // 로그인 시점엔 닉네임을 갱신하지 않는다 — name을 넘기면 사용자가 방 생성/입장 시
    // 커스텀으로 설정해둔 닉네임이 매 로그인마다 구글 실명으로 덮어써짐
    res.json(await getProfile(userId))
  } catch (err) {
    console.error('Google 로그인 실패:', err.message)
    res.status(401).json({ message: '로그인에 실패했습니다.' })
  }
})

app.get('/api/auth/me', async (req, res) => {
  const userId = verifySession(req.cookies[SESSION_COOKIE])
  if (!userId) return res.json(null)
  try {
    res.json(await getProfile(userId))
  } catch (err) {
    console.error('프로필 조회 실패:', err)
    res.status(500).json({ message: '프로필을 불러오지 못했습니다.' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS)
  res.json({ ok: true })
})

// ─── 정적 파일(빌드된 client) ───────────────────────────────────────────────
// Dockerfile이 client를 빌드해 이 서버 이미지의 public/ 아래로 복사해 넣는다.
// /api, /socket.io로 시작하지 않는 나머지 GET 요청은 index.html로 돌려보내
// React가 그 이후 라우팅(이 앱은 클라이언트 라우터 없이 내부 상태로만 화면 전환하므로
// 사실상 '/'만 해당)을 처리하게 한다.
app.use(express.static(path.join(__dirname, 'public')))
app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ─── Socket.io ───────────────────────────────────────────────────────────────

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN, credentials: true } })

// roomId → { board, players, nicknames, currentTurn, status, lastMove, chat,
//             timers, timerInterval, type, userIds, initialRatings,
//             pendingUsers(ranked_pending only), rematchVotes }
const rooms = new Map()
const rankedQueue = []  // [{ socketId, userId, nickname, rating }]
// ranked:queue:join이 getProfile await 중인 userId 집합 — await 이전에 동기로 예약해
// 같은 유저가 동시에 여러 탭에서 큐에 들어가 서로 다른 상대와 이중 매칭되는 걸 막는다
const queueingUserIds = new Set()

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function getRoomBySocket(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.includes(socketId)) return { roomId, room }
  }
  return null
}

function buildRoomState(room) {
  return {
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
  }
}

function emitRoomState(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('room:state', buildRoomState(room))
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
      const winnerIdx = r.currentTurn === 1 ? 1 : 0
      const winnerId = r.players[winnerIdx]
      endGame(roomId, { winner: winnerIdx + 1, winnerId, reason: 'timeout' })
    }
  }, 1000)
}

// 게임 종료 공통 처리(타이머 정지·상태 갱신·room:state/game:over 브로드캐스트·레이팅 반영).
// gameOverPayload는 그대로 'game:over' 이벤트로 나가므로 winner를 반드시 포함해야 함
// (applyRankedRating이 승패 판정에 그대로 사용, draw는 winner:0)
function endGame(roomId, gameOverPayload) {
  const room = rooms.get(roomId)
  if (!room) return
  clearInterval(room.timerInterval)
  room.status = 'ended'
  emitRoomState(roomId)
  io.to(roomId).emit('game:over', gameOverPayload)
  // 레이팅/기보 저장은 DB I/O라 await하지 않고 백그라운드로 흘려보냄 — game:over는 이미
  // 위에서 즉시 브로드캐스트됐으니 클라이언트 응답성과는 무관, 실패해도 내부에서 로깅만 함
  applyRankedRating(roomId, gameOverPayload)
}

async function applyRankedRating(roomId, gameOverPayload) {
  const room = rooms.get(roomId)
  if (!room || room.type !== 'ranked' || room.players.length < 2) return
  const [p1, p2] = room.players
  const uid1 = room.userIds?.[p1]
  const uid2 = room.userIds?.[p2]
  if (!uid1 || !uid2 || uid1 === uid2) return
  const { winner, reason, forbiddenType } = gameOverPayload
  const score = winner === 1 ? 1 : winner === 2 ? 0 : 0.5
  try {
    const result = await applyResult(uid1, uid2, score)
    io.to(p1).emit('rating:update', { delta: result.deltaA, newRating: result.ratingA })
    io.to(p2).emit('rating:update', { delta: result.deltaB, newRating: result.ratingB })
    await recordGame({
      blackUserId: uid1,
      whiteUserId: uid2,
      winner,
      reason,
      forbiddenType,
      blackRatingBefore: room.initialRatings[p1],
      whiteRatingBefore: room.initialRatings[p2],
      blackRatingDelta: result.deltaA,
      whiteRatingDelta: result.deltaB,
      moves: room.moves || [],
      startedAt: room.startedAt || new Date(),
    })
  } catch (err) {
    console.error('[applyRankedRating] 레이팅/기보 저장 실패:', err)
  }
}

// ─── 이벤트 핸들러 ────────────────────────────────────────────────────────────

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  let token = null
  if (match) {
    try { token = decodeURIComponent(match[1]) } catch { token = null }
  }
  socket.data.userId = verifySession(token)
  next()
})

io.on('connection', (socket) => {
  const userId = socket.data.userId
  console.log('connected:', socket.id)

  // ── 방 만들기 (공개) ────────────────────────────────────────────────────
  // type은 클라이언트 입력을 신뢰하지 않고 항상 'public'으로 고정한다 — 랭킹전 방은
  // ranked:queue:join 매칭 경로로만 생성되며, 여기서 'ranked'를 허용하면 매칭 절차 없이
  // 레이팅이 걸린 방을 직접 만들어 조작할 수 있게 된다
  socket.on('room:create', async ({ nickname }) => {
    const roomId = generateRoomId()
    let profile = null
    if (userId) {
      try { profile = await getProfile(userId, nickname) } catch (err) { console.error('프로필 조회 실패:', err) }
    }
    rooms.set(roomId, {
      board: createBoard(),
      players: [socket.id],
      nicknames: { [socket.id]: nickname || '플레이어1' },
      currentTurn: 1,
      status: 'waiting',
      lastMove: null,
      moves: [],
      chat: [],
      timers: { [socket.id]: 180 },
      timerInterval: null,
      type: 'public',
      userIds: { [socket.id]: userId },
      initialRatings: { [socket.id]: profile?.rating ?? null },
    })
    socket.join(roomId)
    socket.emit('room:created', { roomId })
    emitRoomState(roomId)
  })

  // ── 방 입장 (공개방 목록) ────────────────────────────────────────────────
  socket.on('room:join', async ({ roomId, nickname }) => {
    const room = rooms.get(roomId)
    if (!room) { socket.emit('room:error', { message: '방을 찾을 수 없습니다.' }); return }
    if (room.players.length >= 2) { socket.emit('room:error', { message: '방이 가득 찼습니다.' }); return }
    if (room.status !== 'waiting') { socket.emit('room:error', { message: '이미 게임이 시작된 방입니다.' }); return }

    // 자리 선점(동기) — getProfile await 도중 다른 room:join이 끼어들어 같은 방에 3번째
    // 플레이어가 들어오는 경합을 막기 위해, DB 조회 전에 먼저 players/status를 확정한다.
    // socket.join도 status='playing' 전환보다 먼저 동기로 끝내야 한다 — 그래야 await 도중
    // 상대가 game:move를 보내도(예: 초고속 승리) 이 소켓이 이미 io room 멤버라서
    // room:state/game:over 브로드캐스트를 놓치지 않는다
    room.players.push(socket.id)
    room.nicknames[socket.id] = nickname || '플레이어2'
    room.timers[socket.id] = 180
    room.userIds[socket.id] = userId
    socket.join(roomId)
    room.status = 'playing'

    let profile = null
    if (userId) {
      try { profile = await getProfile(userId, nickname) } catch (err) { console.error('프로필 조회 실패:', err) }
    }
    room.initialRatings[socket.id] = profile?.rating ?? null

    io.to(roomId).emit('room:joined', { roomId })
    startTimer(roomId)
    emitRoomState(roomId)
  })

  // ── 관전 (진행 중인 공개방) ──────────────────────────────────────────────
  // room.players에는 추가하지 않는다 — socket.join만으로 이후 브로드캐스트(room:state/
  // chat:message/timer:tick/game:over)를 그대로 받게 되고, game:move/chat:send 등은
  // getRoomBySocket(room.players.includes 기준)이 관전자를 못 찾아 자연히 아무 효과가
  // 없다(클라이언트에서도 보드/채팅 입력을 막지만, 서버도 이중으로 안전하게 무시함)
  socket.on('room:spectate', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) { socket.emit('room:error', { message: '방을 찾을 수 없습니다.' }); return }
    socket.join(roomId)
    socket.emit('room:state', buildRoomState(room))
  })

  // ── 랭킹전 대기열 참가 ───────────────────────────────────────────────────
  socket.on('ranked:queue:join', async ({ nickname }) => {
    if (!userId) { socket.emit('room:error', { message: '로그인이 필요합니다.' }); return }

    // 이미 매칭되어 ranked_pending/playing 방에 속해 있는 상태에서 다시 큐에 들어오는 것을
    // 막는다 — 큐 배열만 보고 중복을 걸러내면 매칭 직후~ranked:join 사이의 창에서 같은
    // 유저가 또 다른 상대와 매칭되어 첫 상대가 영원히 대기하게 되는 문제가 있었음.
    // 이 체크와 큐잉 예약(queueingUserIds.add)은 반드시 getProfile await 이전에 동기로 끝내야
    // 한다 — 그렇지 않으면 같은 유저가 두 탭에서 거의 동시에 큐에 들어왔을 때 둘 다
    // alreadyMatched=false를 보고 통과해, 대기 중이던 서로 다른 두 상대와 각각 매칭되어
    // 이중 매칭될 수 있다
    const alreadyMatched = [...rooms.values()].some(r =>
      r.type === 'ranked' &&
      (r.status === 'ranked_pending' || r.status === 'playing') &&
      (r.pendingUsers?.some(p => p.userId === userId) || Object.values(r.userIds || {}).includes(userId))
    )
    if (alreadyMatched || queueingUserIds.has(userId)) {
      socket.emit('room:error', { message: '이미 매칭이 진행 중입니다.' })
      return
    }
    queueingUserIds.add(userId)

    const nick = nickname || '플레이어'
    let profile
    // 예약(queueingUserIds.add)은 성공/실패 어느 경로로 끝나든 반드시 해제해야 하므로 finally로 모은다
    try {
      profile = await getProfile(userId, nick)
    } catch (err) {
      console.error('프로필 조회 실패:', err)
      socket.emit('room:error', { message: '잠시 후 다시 시도해주세요.' })
      return
    } finally {
      queueingUserIds.delete(userId)
    }

    // 중복 제거 — getProfile await 이후부터는 끝까지 동기로 처리해 다른 ranked:queue:join과
    // 경합 없이 큐 상태를 안전하게 읽고 쓴다
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
        moves: [],
        chat: [],
        timers: {},
        timerInterval: null,
        type: 'ranked',
        userIds: {},
        initialRatings: {},
        // socketId도 함께 저장 — ranked:join 전에 상대가 끊기면 disconnect 핸들러가
        // room.players(아직 비어있을 수 있음)가 아니라 이 socketId로 알림을 보낸다
        pendingUsers: [
          { userId: opp.userId,  socketId: opp.socketId, nickname: opp.nickname, rating: opp.rating },
          { userId,              socketId: socket.id,     nickname: nick,         rating: profile.rating },
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
    if (!userId) { socket.emit('room:error', { message: '로그인이 필요합니다.' }); return }
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
      room.startedAt = new Date()
      startTimer(roomId)
      emitRoomState(roomId)
    }
  })

  // ── 프로필 조회 ──────────────────────────────────────────────────────────
  socket.on('profile:get', async () => {
    if (!userId) return
    try {
      socket.emit('profile:data', await getProfile(userId))
    } catch (err) {
      console.error('프로필 조회 실패:', err)
    }
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
    if (!Number.isInteger(row) || !Number.isInteger(col) ||
        row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return
    if (room.board[row][col] !== 0) return

    if (playerNumber === 1) {
      const forbidden = checkForbidden(room.board, row, col)
      if (forbidden) {
        room.board[row][col] = 1
        room.lastMove = { row, col, player: 1 }
        room.moves.push({ row, col, player: 1 })
        endGame(roomId, {
          winner: 2, winnerId: room.players[1],
          reason: 'forbidden', forbiddenType: forbidden, forbiddenMove: { row, col },
        })
        return
      }
    }

    room.board[row][col] = playerNumber
    room.lastMove = { row, col, player: playerNumber }
    room.moves.push({ row, col, player: playerNumber })

    const winLine = checkWin(room.board, row, col, playerNumber)
    if (winLine) {
      endGame(roomId, { winner: playerNumber, winnerId: socket.id, reason: 'win', winMove: { row, col }, winLine })
      return
    }
    if (isBoardFull(room.board)) {
      endGame(roomId, { winner: 0, reason: 'draw' })
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
    if (!found) {
      // 방이 이미 삭제됐거나(상대 연결 끊김 등), 애초에 이 방의 플레이어가 아닌 경우(예: 관전자가
      // 콘솔로 직접 emit) 모두 해당 — 원인을 구분하지 않고 공통적으로 안내
      socket.emit('room:error', { message: '재경기를 진행할 수 없습니다. 방이 종료되었거나 참가자가 아닙니다.' })
      return
    }
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
    const loserIdx = room.players.indexOf(socket.id)
    const winnerIdx = loserIdx === 0 ? 1 : 0
    const winnerId = room.players[winnerIdx]
    endGame(roomId, { winner: winnerIdx + 1, winnerId, reason: 'surrender' })
  })

  // ── 연결 끊김 ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id)
    const qi = rankedQueue.findIndex(q => q.socketId === socket.id)
    if (qi !== -1) rankedQueue.splice(qi, 1)

    // getRoomBySocket은 room.players만 훑는다 — ranked:join을 아직 안 해서 pendingUsers에만
    // 있는 소켓이 끊기면 여기서 못 찾으므로, ranked_pending 방들의 pendingUsers도 추가로 확인한다
    let found = getRoomBySocket(socket.id)
    if (!found) {
      for (const [rid, r] of rooms.entries()) {
        if (r.status === 'ranked_pending' && r.pendingUsers?.some(p => p.socketId === socket.id)) {
          found = { roomId: rid, room: r }
          break
        }
      }
    }
    if (!found) return
    const { roomId, room } = found
    clearInterval(room.timerInterval)

    if (room.status === 'ranked_pending') {
      // ranked:join을 아직 안 한 상대는 room.players가 아니라 pendingUsers에만 socketId가
      // 있으므로, 두 목록을 모두 훑어야 아직 참가하지 않은 상대에게도 알림이 간다
      const targets = new Set([
        ...room.players.filter(pid => pid !== socket.id),
        ...(room.pendingUsers || []).map(p => p.socketId).filter(sid => sid && sid !== socket.id),
      ])
      targets.forEach(pid => io.to(pid).emit('room:error', { message: '상대 연결이 끊겼습니다.' }))
      rooms.delete(roomId)
      return
    }
    if (room.status === 'playing') {
      const remaining = room.players.find(id => id !== socket.id)
      if (remaining) {
        const winnerNumber = room.players.indexOf(remaining) + 1
        endGame(roomId, { winner: winnerNumber, winnerId: remaining, reason: 'disconnect' })
      } else {
        room.status = 'ended'
      }
    }
    rooms.delete(roomId)
  })
})

const PORT = process.env.PORT || 4000
server.listen(PORT, () => console.log(`오목 서버 실행 중: http://localhost:${PORT}`))
