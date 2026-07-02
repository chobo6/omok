import { useState } from 'react'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Leaderboard from './pages/Leaderboard'
import { getUserId } from './utils/userId'
import './App.css'

const userId = getUserId()

function App() {
  const [page, setPage] = useState('lobby')
  const [gameConfig, setGameConfig] = useState(null)

  const goToGame = (config) => { setGameConfig(config); setPage('game') }
  const goToLobby = () => { setGameConfig(null); setPage('lobby') }

  return (
    <div className="app">
      {page === 'lobby' && (
        <Lobby
          userId={userId}
          onStart={goToGame}
          onLeaderboard={() => setPage('leaderboard')}
        />
      )}
      {page === 'game' && (
        <Game config={gameConfig} userId={userId} onLeave={goToLobby} />
      )}
      {page === 'leaderboard' && (
        <Leaderboard onBack={goToLobby} />
      )}
    </div>
  )
}

export default App
