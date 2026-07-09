import styles from './PlayerInfo.module.css'

// result: { text: '승리'|'패배'|'무승부', variant: 'win'|'lose'|'draw', reason?: string } — 게임 종료 시 턴뱃지 자리에 표시
export default function PlayerInfo({ player, isMyTurn, timeLeft, showRating, result, ratingDelta }) {
  const minutes = Math.floor(timeLeft / 60)
  const seconds = String(timeLeft % 60).padStart(2, '0')
  const isLow = timeLeft <= 30

  return (
    <div className={`${styles.card} ${isMyTurn ? styles.active : ''} ${result ? styles[result.variant] : ''}`}>
      <div
        className={styles.stone}
        style={{
          background: player.color === 'black' ? '#111' : '#fff',
          border: player.color === 'black' ? '2px solid #555' : '2px solid #ccc',
        }}
      />
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <div className={styles.name}>{player.nickname}</div>
          {showRating && player.rating != null && (
            <div className={styles.rating}>
              {player.rating}
              {ratingDelta != null && (
                <span className={ratingDelta >= 0 ? styles.ratingUp : styles.ratingDown}>
                  {ratingDelta >= 0 ? '+' : ''}{ratingDelta}
                </span>
              )}
            </div>
          )}
        </div>
        <div className={`${styles.timer} ${isLow ? styles.low : ''}`}>
          {minutes}:{seconds}
        </div>
      </div>
      {result ? (
        <div className={`${styles.resultBadge} ${styles[result.variant]}`}>
          {result.text}{result.reason ? ` · ${result.reason}` : ''}
        </div>
      ) : (
        isMyTurn && <div className={styles.turnBadge}>내 차례</div>
      )}
    </div>
  )
}
