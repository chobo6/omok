import { useState, useEffect } from 'react'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Leaderboard from './pages/Leaderboard'
import { fetchMe } from './utils/auth'
import './App.css'

function App() {
  const [page, setPage] = useState('lobby')
  const [gameConfig, setGameConfig] = useState(null)
  const [me, setMe] = useState(null)

  useEffect(() => { fetchMe().then(setMe) }, [])

  const goToGame = (config) => { setGameConfig(config); setPage('game') }
  const goToLobby = () => { setGameConfig(null); setPage('lobby') }

  return (
    <div className="app">
      {page === 'lobby' && (
        <Lobby
          me={me}
          onAuthChange={setMe}
          onStart={goToGame}
          onLeaderboard={() => setPage('leaderboard')}
        />
      )}
      {page === 'game' && (
        <Game config={gameConfig} onLeave={goToLobby} />
      )}
      {page === 'leaderboard' && (
        <Leaderboard onBack={goToLobby} />
      )}
    </div>
  )
}

export default App
