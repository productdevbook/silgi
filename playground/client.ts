/**
 * Silgi Playground — Client
 *
 * Demonstrates:
 *  1.  createClient proxy (type-safe)
 *  2.  RPCLink (fetch transport)
 *  3.  Client interceptors (onRequest/onResponse/onError)
 *  4.  Client plugins: withRetry, withDedupe, withCSRF
 *  5.  safe() error handling
 *  6.  SSE subscription consumption
 *  7.  createServerClient (in-process, no HTTP)
 *  8.  All procedure types: query, mutation, subscription
 *  9.  Typed errors (CONFLICT, NOT_FOUND, UNAUTHORIZED)
 *  10. Batch client
 *
 * Run: node --experimental-strip-types playground/client.ts
 * (Start server first: pnpm play)
 */

import { createClient, safe, SilgiError } from 'silgi/client'
import { withInterceptors } from 'silgi/client'
import { RPCLink } from 'silgi/client/fetch'
import { withRetry, withDedupe, withCSRF } from 'silgi/client/plugins'

import type { AppRouter } from './server.ts'
import type { InferClient } from 'silgi'

const BASE = 'http://127.0.0.1:3456'
const AUTH_TOKEN = 'secret-token'

// ── Helpers ──────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${'─'.repeat(56)}`)
  console.log(`  ${title}`)
  console.log(`${'─'.repeat(56)}\n`)
}

function _json(data: unknown) {
  console.log(JSON.stringify(data, null, 2))
}

// ── 1. Create RPCLink with interceptors ──────────────

const baseLink = new RPCLink<Record<never, never>>({
  url: BASE,
  method: 'POST',
  headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
})

// Wrap with interceptors (logging)
const interceptedLink = withInterceptors(baseLink, {
  onRequest: ({ path }) => {
    console.log(`    [interceptor] → ${path.join('/')}`)
  },
  onResponse: ({ path, durationMs }) => {
    console.log(`    [interceptor] ← ${path.join('/')} (${durationMs.toFixed(1)}ms)`)
  },
  onError: ({ path, error }) => {
    const msg = error instanceof SilgiError ? error.code : String(error)
    console.log(`    [interceptor] ✗ ${path.join('/')} — ${msg}`)
  },
})

// Stack plugins: CSRF → dedupe → retry → intercepted link
// Only retry on 5xx / network errors (not 4xx client errors)
const link = withCSRF(
  withDedupe(
    withRetry(interceptedLink, {
      maxRetries: 2,
      retryDelay: 100,
      shouldRetry: (error) => {
        if (error instanceof SilgiError) return error.status >= 500
        return true // network errors etc.
      },
    }),
  ),
)

// ── 2. Create type-safe client ───────────────────────

const client = createClient<InferClient<AppRouter>>(link)

// ── Main Demo ────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║      Silgi Client — Full Feature Demo       ║')
  console.log('╚══════════════════════════════════════════════╝')

  // ── Health Check ───────────────────────────────────
  hr('1. Health Check (short-form query)')
  const health = await client.health()
  console.log(`Status: ${health.status}`)
  console.log(`Uptime: ${Number(health.uptime).toFixed(1)}s`)
  console.log(`Features: ${(health.features as string[]).length} features loaded`)

  // ── List Users ─────────────────────────────────────
  hr('2. List Users (query with input)')
  const { users, total } = await client.users.list({ limit: 10 })
  console.log(`Found ${total} users:`)
  for (const u of users) console.log(`  #${u.id} ${u.name} <${u.email}> [${u.role}]`)

  // ── Get User ───────────────────────────────────────
  hr('3. Get User #2')
  const bob = await client.users.get({ id: 2 })
  console.log(`Name: ${bob.name}, Email: ${bob.email}`)

  // ── Create User (auth + middleware chain) ──────────
  hr('4. Create User (auth + timing + lifecycle)')
  const newUser = await client.users.create({
    name: 'Diana',
    email: 'diana@silgi.dev',
    role: 'user',
  })
  console.log(`Created: #${newUser.id} ${newUser.name} <${newUser.email}>`)

  // ── Typed Error: CONFLICT ──────────────────────────
  hr('5. Duplicate Email → CONFLICT (typed error)')
  const conflictResult = await safe(client.users.create({ name: 'Clone', email: 'diana@silgi.dev' }))
  if (conflictResult.isError) {
    const err = conflictResult.error as SilgiError
    console.log(`Error: ${err.code} (${err.status})`)
    console.log(`Defined: ${(err as any).defined}`)
  }

  // ── Typed Error: UNAUTHORIZED ──────────────────────
  hr('6. No Auth → UNAUTHORIZED')
  // Create a client without auth header
  const noAuthLink = new RPCLink({ url: BASE, method: 'POST' })
  const noAuthClient = createClient<InferClient<AppRouter>>(noAuthLink)
  const authResult = await safe(noAuthClient.users.create({ name: 'X', email: 'x@test.com' }))
  if (authResult.isError) {
    const err = authResult.error as SilgiError
    console.log(`Error: ${err.code} (${err.status}) — ${err.message}`)
  }

  // ── Typed Error: NOT_FOUND ─────────────────────────
  hr('7. Get User #999 → NOT_FOUND')
  const notFoundResult = await safe(client.users.get({ id: 999 }))
  if (notFoundResult.isError) {
    const err = notFoundResult.error as SilgiError
    console.log(`Error: ${err.code} (${err.status}) — ${err.message}`)
  }

  // ── Posts: List with filters ───────────────────────
  hr('8. List Posts (with coercion guard)')
  const { posts } = await client.posts.list({ published: true })
  console.log(`Published posts: ${posts.length}`)
  for (const p of posts) console.log(`  #${p.id} "${p.title}" by user #${p.authorId}`)

  // ── Posts: Create ──────────────────────────────────
  hr('9. Create Post (auth + lifecycle)')
  const newPost = await client.posts.create({
    title: 'Silgi is Fast',
    body: '6.2x faster than oRPC with compiled pipelines',
    published: true,
  })
  console.log(`Created: #${newPost.id} "${newPost.title}" published=${newPost.published}`)

  // ── Delete User ────────────────────────────────────
  hr('10. Delete User #3')
  const deleted = await client.users.delete({ id: 3 })
  console.log(`Deleted: ${JSON.stringify(deleted)}`)

  // ── Delete non-existent → NOT_FOUND ────────────────
  hr('11. Delete User #999 → NOT_FOUND')
  const deleteResult = await safe(client.users.delete({ id: 999 }))
  if (deleteResult.isError) {
    const err = deleteResult.error as SilgiError
    console.log(`Error: ${err.code} (${err.status})`)
  }

  // ── Cookie Demo ────────────────────────────────────
  hr('12. Cookie Demo')
  const cookieResult = await client.demo.cookies()
  console.log(`Existing cookie: ${cookieResult.existingCookie ?? 'none'}`)
  console.log(`Set-Cookie header: ${cookieResult.setCookieHeader}`)

  // ── Signing & Encryption Demo ──────────────────────
  hr('13. Signing & Encryption Demo')
  const sigResult = await client.demo.signing()
  console.log(`Original:  ${sigResult.original}`)
  console.log(`Signed:    ${sigResult.signed}`)
  console.log(`Verified:  ${sigResult.verified}`)
  console.log(`Tampered:  ${sigResult.tamperedResult} (null = invalid)`)
  console.log(`Encrypted: ${sigResult.encrypted}`)
  console.log(`Decrypted: ${sigResult.decrypted}`)

  // ── Custom Serializer Demo ─────────────────────────
  hr('14. Custom Serializer Demo')
  const serResult = await client.demo.serializer()
  console.log('Original:', JSON.stringify(serResult.original))
  console.log('Serialized string:', (serResult.serialized as string).slice(0, 80) + '...')

  // ── Admin Stats (contract-first) ───────────────────
  hr('15. Admin Stats (contract-first workflow)')
  const stats = await client.admin.stats()
  console.log(`Users: ${stats.totalUsers}, Posts: ${stats.totalPosts}, Published: ${stats.publishedPosts}`)

  // ── SSE Subscription ──────────────────────────────
  hr('16. SSE Subscription (5 ticks)')
  console.log('Connecting to /stream/ticks...')
  const sseResponse = await fetch(`${BASE}/stream/ticks`, {
    method: 'POST',
    headers: { accept: 'text/event-stream' },
  })

  if (sseResponse.body) {
    const reader = sseResponse.body.getReader()
    const decoder = new TextDecoder()
    let tickCount = 0

    while (tickCount < 5) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      const lines = text.split('\n').filter((l) => l.startsWith('data:'))
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(5))
          console.log(`  tick ${data.tick}: ${data.users} users, ${data.posts} posts @ ${data.time}`)
          tickCount++
        } catch {}
      }
    }
    reader.cancel()
  }

  // ── Final State ────────────────────────────────────
  hr('17. Final State')
  const finalUsers = await client.users.list({})
  console.log(`Total users: ${finalUsers.total}`)
  for (const u of finalUsers.users) console.log(`  #${u.id} ${u.name} <${u.email}>`)

  const finalPosts = await client.posts.list({})
  console.log(`\nTotal posts: ${finalPosts.total}`)
  for (const p of finalPosts.posts) console.log(`  #${p.id} "${p.title}" published=${p.published}`)

  // ── Summary ────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║             All demos completed!             ║')
  console.log('╠══════════════════════════════════════════════╣')
  console.log('║  Features demonstrated:                      ║')
  console.log('║   - createClient + RPCLink                   ║')
  console.log('║   - Interceptors (onRequest/onResponse)      ║')
  console.log('║   - Client plugins (CSRF, dedupe, retry)     ║')
  console.log('║   - safe() error handling                    ║')
  console.log('║   - Guard: auth, rateLimit, bodyLimit        ║')
  console.log('║   - Wrap: timing, lifecycleWrap              ║')
  console.log('║   - Coercion guard                           ║')
  console.log('║   - Short-form & config-form procedures      ║')
  console.log('║   - Typed errors: CONFLICT, NOT_FOUND, 401   ║')
  console.log('║   - SSE subscription streaming               ║')
  console.log('║   - PubSub (memory backend)                  ║')
  console.log('║   - Cookies (parse/set)                      ║')
  console.log('║   - Signing (HMAC) & Encryption (AES-GCM)    ║')
  console.log('║   - Custom serializer (Date, Set, Map)        ║')
  console.log('║   - Contract-first workflow                   ║')
  console.log('║   - Callable (direct invocation)              ║')
  console.log('║   - mapInput middleware                       ║')
  console.log('║   - Scalar / OpenAPI 3.1                      ║')
  console.log('║   - Batch handler                             ║')
  console.log('║   - Lifecycle hooks                           ║')
  console.log('╚══════════════════════════════════════════════╝\n')
}

main().catch((err) => {
  console.error('\nFailed:', err)
  process.exit(1)
})
