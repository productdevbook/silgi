import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { queryUtils, client } from './client'

export default function App() {
  const [name, setName] = useState('World')

  // Use Silgi TanStack Query utils for type-safe queries
  const health = useQuery(queryUtils.health.queryOptions({ input: undefined as never }))

  const echo = useQuery(queryUtils.echo.queryOptions({ input: { msg: 'Hello from React!' } }))

  // Direct client call via useMutation
  const greetMutation = useMutation({
    mutationFn: (input: { name: string }) => client.greet(input),
  })

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: 600 }}>
      <h1>Silgi React Client</h1>
      <p style={{ color: '#666' }}>Connects to any Silgi server (standalone, Hono, Express, etc.)</p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Health</h2>
        {health.isLoading && <p>Loading...</p>}
        {health.data && <pre>{JSON.stringify(health.data, null, 2)}</pre>}
        {health.error && <p style={{ color: 'red' }}>Error: {String(health.error)}</p>}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Echo</h2>
        {echo.isLoading && <p>Loading...</p>}
        {echo.data && <pre>{JSON.stringify(echo.data, null, 2)}</pre>}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Greet</h2>
        <div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Enter your name' />
          <button
            onClick={() => greetMutation.mutate({ name })}
            disabled={greetMutation.isPending}
            style={{ marginLeft: '0.5rem' }}
          >
            {greetMutation.isPending ? 'Greeting...' : 'Greet'}
          </button>
        </div>
        {greetMutation.data && (
          <p style={{ marginTop: '0.5rem' }}>{(greetMutation.data as { greeting: string }).greeting}</p>
        )}
        {greetMutation.error && <p style={{ color: 'red' }}>Error: {String(greetMutation.error)}</p>}
      </section>
    </main>
  )
}
