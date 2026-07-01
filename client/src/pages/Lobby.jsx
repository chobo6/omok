import { useState } from 'react'
import styles from './Lobby.module.css'

export default function Lobby({ onStart }) {
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [tab, setTab] = useState('menu') // menu | online | ai

  function handleAI() {
    const nick = nickname.trim() || '플레이어'
    onStart({ mode: 'ai', nickname: nick })
  }

  function handleCreateRoom() {
    const nick = nickname.trim() || '플레이어'
    onStart({ mode: 'online', action: 'create', nickname: nick })
  }

  function handleJoinRoom() {
    if (!roomCode.trim()) return
    const nick = nickname.trim() || '플레이어'
    onStart({ mode: 'online', action: 'join', roomCode: roomCode.trim().toUpperCase(), nickname: nick })
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.stones}>
            <div className={styles.stoneB} />
            <div className={styles.stoneW} />
            <div className={styles.stoneB} />
          </div>
          <h1 className={styles.title}>오목</h1>
          <p className={styles.subtitle}>온라인 오목 게임</p>
        </div>

        <div className={styles.nicknameRow}>
          <input
            className={styles.input}
            placeholder="닉네임 (선택)"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            maxLength={12}
          />
        </div>

        {tab === 'menu' && (
          <div className={styles.menu}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setTab('online')}>
              🌐 온라인 대전
            </button>
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleAI}>
              🤖 AI 대전
            </button>
          </div>
        )}

        {tab === 'online' && (
          <div className={styles.onlinePanel}>
            <button className={styles.backBtn} onClick={() => setTab('menu')}>← 뒤로</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleCreateRoom}>
              방 만들기
            </button>
            <div className={styles.divider}>또는</div>
            <div className={styles.joinRow}>
              <input
                className={styles.input}
                placeholder="방 코드 입력"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleJoinRoom}>
                입장
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
