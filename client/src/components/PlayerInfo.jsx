import styles from './PlayerInfo.module.css'

export default function PlayerInfo({ player, isMyTurn, timeLeft }) {
  const minutes = Math.floor(timeLeft / 60)
  const seconds = String(timeLeft % 60).padStart(2, '0')
  const isLow = timeLeft <= 30

  return (
    <div className={`${styles.card} ${isMyTurn ? styles.active : ''}`}>
      <div className={styles.stone} style={{ background: player.color === 'black' ? '#111' : '#fff', border: player.color === 'black' ? '2px solid #555' : '2px solid #ccc' }} />
      <div className={styles.info}>
        <div className={styles.name}>{player.nickname}</div>
        <div className={`${styles.timer} ${isLow ? styles.low : ''}`}>
          {minutes}:{seconds}
        </div>
      </div>
      {isMyTurn && <div className={styles.turnBadge}>내 차례</div>}
    </div>
  )
}
