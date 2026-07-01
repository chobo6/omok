import { useState } from 'react'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import './App.css'

function App() {
  const [page, setPage] = useState('lobby')
  const [gameConfig, setGameConfig] = useState(null)

  const goToGame = (config) => {
    setGameConfig(config)
    setPage('game')
  }

  const goToLobby = () => {
    setGameConfig(null)
    setPage('lobby')
  }

  return (
    <div className="app">
      {page === 'lobby' && <Lobby onStart={goToGame} />}
      {page === 'game' && <Game config={gameConfig} onLeave={goToLobby} />}
    </div>
  )
}

export default App
