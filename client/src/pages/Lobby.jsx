import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { getGuestNickname } from '../utils/guestNickname'
import { renderGoogleButton, loginWithGoogle, logout as logoutRequest } from '../utils/auth'
import styles from './Lobby.module.css'

export default function Lobby({ me, onAuthChange, onStart, onLeaderboard }) {
  const [tab, setTab] = useState('public')   // public | ranked
  const [publicRooms, setPublicRooms] = useState([])
  const [myProfile, setMyProfile] = useState(null)
  const [inQueue, setInQueue] = useState(false)
  const socketRef = useRef(null)

  const nick = me?.nickname || getGuestNickname()

  // 비로그인 상태면 Google 로그인 버튼을 렌더링
  useEffect(() => {
    if (me) return
    renderGoogleButton('google-signin-button', async (credential) => {
      try {
        const profile = await loginWithGoogle(credential)
        onAuthChange(profile)
      } catch {
        alert('로그인에 실패했습니다.')
      }
    })
  }, [me])

  async function handleLogout() {
    await logoutRequest()
    onAuthChange(null)
  }

  // 공개방 목록 2초마다 폴링
  useEffect(() => {
    if (tab !== 'public') return
    const fetchRooms = async () => {
      try {
        const res = await fetch('/api/rooms')
        setPublicRooms(await res.json())
      } catch {}
    }
    fetchRooms()
    const iv = setInterval(fetchRooms, 2000)
    return () => clearInterval(iv)
  }, [tab])

  // 랭킹전 탭: 로그인 상태일 때만 소켓 연결 + 프로필 로드
  useEffect(() => {
    if (tab !== 'ranked' || !me) return

    const socket = io('/', { path: '/socket.io', withCredentials: true })
    socketRef.current = socket

    socket.on('connect', () => socket.emit('profile:get'))
    socket.on('profile:data', setMyProfile)
    socket.on('ranked:queue:status', () => setInQueue(true))
    socket.on('ranked:match:found', ({ roomId }) => {
      setInQueue(false)
      socket.disconnect()
      socketRef.current = null
      onStart({ mode: 'online', action: 'ranked_join', roomCode: roomId, nickname: nick })
    })
    socket.on('room:error', ({ message }) => {
      alert(message)
      setInQueue(false)
    })

    return () => {
      socket.emit('ranked:queue:leave')
      socket.disconnect()
      socketRef.current = null
      setInQueue(false)
    }
  }, [tab, me]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleJoinQueue() {
    socketRef.current?.emit('ranked:queue:join', { nickname: nick })
    setInQueue(true)
  }

  function handleLeaveQueue() {
    socketRef.current?.emit('ranked:queue:leave')
    setInQueue(false)
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* 로고 */}
        <div className={styles.logo}>
          <div className={styles.stones}>
            <div className={styles.stoneB} />
            <div className={styles.stoneW} />
            <div className={styles.stoneB} />
          </div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>오목</h1>
            <button className={styles.rankBtn} onClick={onLeaderboard}>순위표</button>
          </div>
          <p className={styles.subtitle}>온라인 오목 · 렌주룰</p>
        </div>

        {/* 로그인 상태 */}
        <div className={styles.nicknameRow}>
          {me ? (
            <div className={styles.authRow}>
              <span>{me.nickname}님</span>
              <button className={`${styles.btn} ${styles.btnSmall}`} onClick={handleLogout}>로그아웃</button>
            </div>
          ) : (
            <div className={styles.authRow}>
              <span>게스트: {nick}</span>
              <div id="google-signin-button" />
            </div>
          )}
        </div>

        {/* 탭 */}
        <div className={styles.tabs}>
          {[
            { key: 'public',  label: '공개방' },
            { key: 'ranked',  label: '랭킹전' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 공개방 */}
        {tab === 'public' && (
          <div className={styles.panel}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => onStart({ mode: 'online', action: 'create', nickname: nick, type: 'public' })}
            >
              공개방 만들기
            </button>
            <div className={styles.roomList}>
              {publicRooms.length === 0 ? (
                <div className={styles.emptyRooms}>공개방이 없습니다</div>
              ) : (
                publicRooms.map(room => {
                  const isFull = room.playerCount >= 2
                  return (
                    <div key={room.roomId} className={styles.roomItem}>
                      <div className={styles.roomInfo}>
                        <span className={styles.roomHost}>{room.host}</span>
                        <span className={styles.roomCount}>{room.playerCount}/2</span>
                      </div>
                      <button
                        className={`${styles.btn} ${styles.btnSmall}`}
                        onClick={() => onStart({
                          mode: 'online',
                          action: isFull ? 'spectate' : 'join',
                          roomCode: room.roomId,
                          nickname: nick,
                        })}
                      >
                        {isFull ? '관전' : '입장'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* 랭킹전 */}
        {tab === 'ranked' && (
          <div className={styles.panel}>
            {!me ? (
              <div className={styles.emptyRooms}>랭킹전은 로그인이 필요합니다.</div>
            ) : (
              <>
                {myProfile && (
                  <div className={styles.profileBox}>
                    <div className={styles.ratingLabel}>내 레이팅 (ELO)</div>
                    <div className={styles.ratingValue}>{myProfile.rating}</div>
                    <div className={styles.recordRow}>
                      <span className={styles.win}>{myProfile.wins}승</span>
                      <span className={styles.lose}>{myProfile.losses}패</span>
                      {myProfile.draws > 0 && <span className={styles.draw}>{myProfile.draws}무</span>}
                    </div>
                  </div>
                )}
                {!inQueue ? (
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleJoinQueue}>
                    대기열 참가
                  </button>
                ) : (
                  <div className={styles.queueBox}>
                    <div className={styles.queueSpinner} />
                    <p className={styles.queueText}>상대를 찾는 중...</p>
                    <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleLeaveQueue}>
                      취소
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* AI 대전 (항상 하단 고정) — 흑/백 선택 */}
        <div className={styles.aiColorRow}>
          <button
            className={`${styles.btn} ${styles.btnAI}`}
            onClick={() => onStart({ mode: 'ai', nickname: nick, humanColor: 'black' })}
          >
            AI 대전 (흑으로 시작)
          </button>
          <button
            className={`${styles.btn} ${styles.btnAI}`}
            onClick={() => onStart({ mode: 'ai', nickname: nick, humanColor: 'white' })}
          >
            AI 대전 (백으로 시작)
          </button>
        </div>
      </div>
    </div>
  )
}
