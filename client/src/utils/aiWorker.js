import { getAIMove } from './aiEngine'

self.onmessage = (e) => {
  const { board, aiPlayer } = e.data
  const move = getAIMove(board, aiPlayer)
  self.postMessage(move)
}
