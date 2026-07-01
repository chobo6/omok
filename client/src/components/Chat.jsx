import { useState, useEffect, useRef } from 'react'
import styles from './Chat.module.css'

export default function Chat({ messages, onSend }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    const trimmed = input.trim()
    if (!trimmed) return
    onSend(trimmed)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSend()
  }

  return (
    <div className={styles.chat}>
      <div className={styles.header}>채팅</div>
      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} className={styles.message}>
            <span className={styles.nick}>{msg.nickname}</span>
            <span className={styles.text}>{msg.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지 입력..."
          maxLength={100}
        />
        <button className={styles.sendBtn} onClick={handleSend}>전송</button>
      </div>
    </div>
  )
}
