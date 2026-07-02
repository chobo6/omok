import { useState, useEffect } from 'react'
import styles from './Leaderboard.module.css'

export default function Leaderboard({ onBack }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const medal = ['🥇', '🥈', '🥉']

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={onBack}>← 뒤로</button>
          <h2 className={styles.title}>순위표</h2>
          <span className={styles.sub}>ELO 레이팅 기준</span>
        </div>

        {loading ? (
          <div className={styles.empty}>불러오는 중...</div>
        ) : data.length === 0 ? (
          <div className={styles.empty}>아직 랭킹 데이터가 없습니다.<br/>랭킹전을 플레이해보세요!</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>순위</th>
                <th>닉네임</th>
                <th>레이팅</th>
                <th>승</th>
                <th>패</th>
                <th>승률</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p, i) => {
                const total = p.wins + p.losses + p.draws
                const rate = total > 0 ? Math.round((p.wins / total) * 100) : 0
                return (
                  <tr key={p.userId} className={i < 3 ? styles.top : ''}>
                    <td className={styles.rank}>
                      {medal[i] ?? i + 1}
                    </td>
                    <td className={styles.nickname}>{p.nickname}</td>
                    <td className={styles.ratingCell}>{p.rating}</td>
                    <td className={styles.winCell}>{p.wins}</td>
                    <td className={styles.lossCell}>{p.losses}</td>
                    <td className={styles.rateCell}>{rate}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
