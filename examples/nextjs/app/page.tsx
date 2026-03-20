'use client'

import { useState, useEffect } from 'react'

export default function Home() {
  const [health, setHealth] = useState<{ status: string; framework: string } | null>(null)
  const [greeting, setGreeting] = useState<string>('')
  const [name, setName] = useState('World')

  useEffect(() => {
    fetch('/api/rpc/health', { method: 'POST' })
      .then((r) => r.json())
      .then(setHealth)
  }, [])

  const greet = async () => {
    const res = await fetch('/api/rpc/greet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    setGreeting(data.greeting)
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Silgi + Next.js</h1>
      <p>Health: {health ? `${health.status} (${health.framework})` : 'loading...'}</p>
      <div style={{ marginTop: '1rem' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Enter your name' />
        <button onClick={greet} style={{ marginLeft: '0.5rem' }}>
          Greet
        </button>
      </div>
      {greeting && <p style={{ marginTop: '1rem' }}>{greeting}</p>}
    </main>
  )
}
