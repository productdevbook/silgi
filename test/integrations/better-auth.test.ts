import { describe, expect, it } from 'vitest'

import { instrumentBetterAuth, tracing, withCtx } from '#src/integrations/better-auth/index.ts'
import { RequestTrace } from '#src/plugins/analytics.ts'

// ── tracing() plugin ────────────────────────────

describe('tracing() — plugin factory', () => {
  it('returns object with id: "silgi-tracing"', () => {
    const plugin = tracing()
    expect(plugin.id).toBe('silgi-tracing')
  })

  it('has onRequest and hooks.after properties', () => {
    const plugin = tracing()
    expect(typeof plugin.onRequest).toBe('function')
    expect(plugin.hooks).toBeDefined()
    expect(Array.isArray(plugin.hooks.after)).toBe(true)
    expect(plugin.hooks.after).toHaveLength(1)
    expect(typeof plugin.hooks.after[0].matcher).toBe('function')
    expect(typeof plugin.hooks.after[0].handler).toBe('function')
  })

  it('matcher returns true for all requests', () => {
    const plugin = tracing()
    expect(plugin.hooks.after[0].matcher()).toBe(true)
  })
})

describe('tracing() — path matching', () => {
  async function matchPath(path: string) {
    const plugin = tracing()
    const request = new Request(`http://localhost${path}`)
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path,
      context: { returned: { user: { id: 'u1' } } },
      body: null,
    })

    return reqTrace.spans[0]
  }

  it('/api/auth/sign-in/email -> auth.signin.email', async () => {
    const span = await matchPath('/api/auth/sign-in/email')
    expect(span!.name).toBe('auth.signin.email')
    expect(span!.attributes!['auth.operation']).toBe('signin')
  })

  it('/api/auth/get-session -> auth.get_session', async () => {
    const span = await matchPath('/api/auth/get-session')
    expect(span!.name).toBe('auth.get_session')
    expect(span!.attributes!['auth.operation']).toBe('get_session')
  })

  it('/api/auth/sign-up/email -> auth.signup.email', async () => {
    const span = await matchPath('/api/auth/sign-up/email')
    expect(span!.name).toBe('auth.signup.email')
    expect(span!.attributes!['auth.operation']).toBe('signup')
  })

  it('/api/auth/sign-out -> auth.signout', async () => {
    const span = await matchPath('/api/auth/sign-out')
    expect(span!.name).toBe('auth.signout')
    expect(span!.attributes!['auth.operation']).toBe('signout')
  })

  it('/api/auth/callback/google -> auth.oauth.callback.google', async () => {
    const span = await matchPath('/api/auth/callback/google')
    expect(span!.name).toBe('auth.oauth.callback.google')
    expect(span!.attributes!['auth.operation']).toBe('oauth_callback')
    expect(span!.attributes!['auth.method']).toBe('oauth')
    expect(span!.attributes!['auth.provider']).toBe('google')
  })

  it('/api/auth/sign-in/github -> auth.oauth.initiate.github', async () => {
    const span = await matchPath('/api/auth/sign-in/github')
    expect(span!.name).toBe('auth.oauth.initiate.github')
    expect(span!.attributes!['auth.operation']).toBe('oauth_initiate')
    expect(span!.attributes!['auth.method']).toBe('oauth')
    expect(span!.attributes!['auth.provider']).toBe('github')
  })

  it('/api/auth/update-user -> auth.update_user', async () => {
    const span = await matchPath('/api/auth/update-user')
    expect(span!.name).toBe('auth.update_user')
  })

  it('/api/auth/change-password -> auth.change_password', async () => {
    const span = await matchPath('/api/auth/change-password')
    expect(span!.name).toBe('auth.change_password')
  })

  it('/api/auth/verify-email -> auth.verify_email', async () => {
    const span = await matchPath('/api/auth/verify-email')
    expect(span!.name).toBe('auth.verify_email')
  })

  it('/api/auth/list-sessions -> auth.list_sessions', async () => {
    const span = await matchPath('/api/auth/list-sessions')
    expect(span!.name).toBe('auth.list_sessions')
  })

  it('unknown path falls back to slug-based name', async () => {
    const span = await matchPath('/api/auth/some-custom-endpoint')
    expect(span!.name).toBe('auth.some_custom_endpoint')
    expect(span!.attributes!['auth.operation']).toBe('unknown')
  })
})

describe('tracing() — hooks.after span recording', () => {
  it('records span with correct attributes', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-in/email',
      context: {
        returned: {
          user: { id: 'user-123', email: 'test@example.com' },
          session: { id: 'sess-456' },
        },
      },
      body: { email: 'test@example.com', password: 'secret' },
    })

    expect(reqTrace.spans).toHaveLength(1)
    const span = reqTrace.spans[0]!
    expect(span.name).toBe('auth.signin.email')
    expect(span.kind).toBe('http')
    expect(span.durationMs).toBeGreaterThanOrEqual(0)
    expect(span.attributes!['auth.operation']).toBe('signin')
    expect(span.attributes!['auth.method']).toBe('email')
    expect(span.attributes!['auth.success']).toBe(true)
    expect(span.attributes!['user.id']).toBe('user-123')
    expect(span.attributes!['user.email']).toBe('test@example.com')
    expect(span.attributes!['session.id']).toBe('sess-456')
  })

  it('extracts user.id and session.id from returned data', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/get-session')
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/get-session',
      context: {
        returned: {
          data: {
            user: { id: 'u-abc', email: 'alice@test.com' },
            session: { id: 's-def' },
          },
        },
      },
      body: null,
    })

    const attrs = reqTrace.spans[0]!.attributes!
    expect(attrs['user.id']).toBe('u-abc')
    expect(attrs['user.email']).toBe('alice@test.com')
    expect(attrs['session.id']).toBe('s-def')
  })

  it('extracts from newSession when returned has no user', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/sign-up/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-up/email',
      context: {
        returned: {},
        newSession: {
          user: { id: 'new-user', email: 'new@test.com' },
          session: { id: 'new-sess' },
        },
      },
      body: null,
    })

    const attrs = reqTrace.spans[0]!.attributes!
    expect(attrs['user.id']).toBe('new-user')
    expect(attrs['user.email']).toBe('new@test.com')
    expect(attrs['session.id']).toBe('new-sess')
  })

  it('writes procedureInput and procedureOutput', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    const body = { email: 'test@example.com', password: 'secret' }
    const returned = { user: { id: 'u1' }, session: { id: 's1' } }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-in/email',
      context: { returned },
      body,
    })

    expect(reqTrace.procedureInput).toEqual(body)
    expect(reqTrace.procedureOutput).toEqual(returned)
  })

  it('captureInput: false suppresses input', async () => {
    const plugin = tracing({ captureInput: false })
    const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-in/email',
      context: { returned: { user: { id: 'u1' } } },
      body: { email: 'test@test.com' },
    })

    expect(reqTrace.spans[0]!.input).toBeUndefined()
    expect(reqTrace.procedureInput).toBeUndefined()
  })

  it('captureOutput: false suppresses output', async () => {
    const plugin = tracing({ captureOutput: false })
    const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    const returned = { user: { id: 'u1' }, session: { id: 's1' } }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-in/email',
      context: { returned },
      body: null,
    })

    expect(reqTrace.spans[0]!.output).toBeUndefined()
    expect(reqTrace.procedureOutput).toBeUndefined()
  })

  it('records auth.success: false when returned has error', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-in/email',
      context: { returned: { error: 'Invalid credentials' } },
      body: null,
    })

    const span = reqTrace.spans[0]!
    expect(span.attributes!['auth.success']).toBe(false)
    expect(span.error).toBe('Invalid credentials')
  })

  it('records error.message from error object', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' })
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: reqTrace }

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/sign-in/email',
      context: { returned: { error: { message: 'Account locked' } } },
      body: null,
    })

    expect(reqTrace.spans[0]!.error).toBe('Account locked')
  })

  it('skips tracing when no __silgiCtx on request', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/get-session')
    await plugin.onRequest(request, {})

    // No __silgiCtx set — should not throw
    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/get-session',
      context: { returned: {} },
      body: null,
    })
    // No crash = pass
  })

  it('skips tracing when no trace on ctx', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/get-session')
    await plugin.onRequest(request, {})
    ;(request as any).__silgiCtx = {} // no trace

    await plugin.hooks.after[0].handler({
      request,
      path: '/api/auth/get-session',
      context: { returned: {} },
      body: null,
    })
    // No crash = pass
  })

  it('falls back to AsyncLocalStorage context when __silgiCtx is missing', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/get-session')
    await plugin.onRequest(request, {})

    const reqTrace = new RequestTrace()
    // No __silgiCtx on request — use withCtx (ALS) instead
    await withCtx({ trace: reqTrace }, async () => {
      await plugin.hooks.after[0].handler({
        request,
        path: '/api/auth/get-session',
        context: { returned: { user: { id: 'u1', email: 'als@test.com' }, session: { id: 's1' } } },
        body: null,
      })
    })

    expect(reqTrace.spans).toHaveLength(1)
    expect(reqTrace.spans[0]!.name).toBe('auth.get_session')
    expect(reqTrace.spans[0]!.attributes!['auth.operation']).toBe('get_session')
    expect(reqTrace.spans[0]!.attributes!['user.id']).toBe('u1')
  })

  it('prefers __silgiCtx over ALS context when both are present', async () => {
    const plugin = tracing()
    const request = new Request('http://localhost/api/auth/sign-in/email')
    await plugin.onRequest(request, {})

    const silgiTrace = new RequestTrace()
    const alsTrace = new RequestTrace()
    ;(request as any).__silgiCtx = { trace: silgiTrace }

    await withCtx({ trace: alsTrace }, async () => {
      await plugin.hooks.after[0].handler({
        request,
        path: '/api/auth/sign-in/email',
        context: { returned: { user: { id: 'u2' } } },
        body: null,
      })
    })

    // Should use __silgiCtx (silgiTrace), not ALS (alsTrace)
    expect(silgiTrace.spans).toHaveLength(1)
    expect(alsTrace.spans).toHaveLength(0)
  })
})

// ── instrumentBetterAuth() ──────────────────────────

function createMockAuth() {
  const calls: { method: string; args: unknown[] }[] = []

  return {
    auth: {
      api: {
        getSession: async (...args: any[]) => {
          calls.push({ method: 'getSession', args })
          return { user: { id: 'u-1', email: 'user@test.com' }, session: { id: 's-1' } }
        },
        signInEmail: async (...args: any[]) => {
          calls.push({ method: 'signInEmail', args })
          return { user: { id: 'u-2', email: 'login@test.com' }, session: { id: 's-2' } }
        },
        signUpEmail: async (...args: any[]) => {
          calls.push({ method: 'signUpEmail', args })
          return { user: { id: 'u-3', email: 'signup@test.com' }, session: { id: 's-3' } }
        },
        signOut: async (...args: any[]) => {
          calls.push({ method: 'signOut', args })
          return { success: true }
        },
        updateUser: async (...args: any[]) => {
          calls.push({ method: 'updateUser', args })
          return { user: { id: 'u-1', email: 'updated@test.com' } }
        },
        customEndpoint: async (...args: any[]) => {
          calls.push({ method: 'customEndpoint', args })
          return { ok: true }
        },
        failingMethod: async () => {
          throw new Error('Auth service unavailable')
        },
        errorReturn: async () => {
          return { error: 'Token expired' }
        },
      },
    } as Record<string, any>,
    calls,
  }
}

describe('instrumentBetterAuth()', () => {
  it('returns the same auth instance', () => {
    const { auth } = createMockAuth()
    const result = instrumentBetterAuth(auth)
    expect(result).toBe(auth)
  })

  it('is idempotent — calling twice does not double-wrap', () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const firstGetSession = auth.api.getSession

    instrumentBetterAuth(auth)
    expect(auth.api.getSession).toBe(firstGetSession)
  })

  it('wraps known api methods (getSession, signInEmail, etc.)', async () => {
    const { auth, calls } = createMockAuth()
    instrumentBetterAuth(auth)

    // Without context — should still work (passthrough)
    const result = await auth.api.getSession({ headers: {} })
    expect(result.user.id).toBe('u-1')
    expect(calls.some((c) => c.method === 'getSession')).toBe(true)
  })

  it('without withCtx — no spans (passthrough)', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)

    const result = await auth.api.getSession({ headers: {} })
    expect(result.user.id).toBe('u-1')
    // No trace context — no way to record spans, but call still succeeds
  })

  it('with withCtx — records span with operation, user.id, session.id', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    const result = await withCtx({ trace: reqTrace }, async () => {
      return auth.api.getSession({ headers: {} })
    })

    expect(result.user.id).toBe('u-1')
    expect(reqTrace.spans).toHaveLength(1)

    const span = reqTrace.spans[0]!
    expect(span.name).toBe('auth.api.get_session')
    expect(span.kind).toBe('http')
    expect(span.durationMs).toBeGreaterThanOrEqual(0)
    expect(span.attributes!['auth.operation']).toBe('get_session')
    expect(span.attributes!['auth.success']).toBe(true)
    expect(span.attributes!['user.id']).toBe('u-1')
    expect(span.attributes!['user.email']).toBe('user@test.com')
    expect(span.attributes!['session.id']).toBe('s-1')
  })

  it('signInEmail records correct span', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return auth.api.signInEmail({ body: { email: 'login@test.com', password: 'pass' } })
    })

    const span = reqTrace.spans[0]!
    expect(span.name).toBe('auth.api.signin')
    expect(span.attributes!['auth.operation']).toBe('signin')
    expect(span.attributes!['auth.method']).toBe('email')
    expect(span.attributes!['user.id']).toBe('u-2')
  })

  it('signUpEmail records correct span', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return auth.api.signUpEmail({ body: { email: 'signup@test.com', password: 'pass' } })
    })

    const span = reqTrace.spans[0]!
    expect(span.name).toBe('auth.api.signup')
    expect(span.attributes!['auth.operation']).toBe('signup')
    expect(span.attributes!['auth.method']).toBe('email')
  })

  it('error handling — thrown error records auth.success: false and error message', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await expect(
      withCtx({ trace: reqTrace }, async () => {
        return auth.api.failingMethod()
      }),
    ).rejects.toThrow('Auth service unavailable')

    expect(reqTrace.spans).toHaveLength(1)
    const span = reqTrace.spans[0]!
    expect(span.attributes!['auth.success']).toBe(false)
    expect(span.attributes!['auth.error']).toBe('Auth service unavailable')
    expect(span.error).toContain('Auth service unavailable')
  })

  it('error handling — returned error sets auth.success: false', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    const result = await withCtx({ trace: reqTrace }, async () => {
      return auth.api.errorReturn()
    })

    expect(result.error).toBe('Token expired')
    expect(reqTrace.spans).toHaveLength(1)
    const span = reqTrace.spans[0]!
    expect(span.attributes!['auth.success']).toBe(false)
    expect(span.attributes!['auth.error']).toBe('Token expired')
  })

  it('unknown methods get snake_case operation name', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return auth.api.customEndpoint()
    })

    const span = reqTrace.spans[0]!
    expect(span.name).toBe('auth.api.custom_endpoint')
    expect(span.attributes!['auth.operation']).toBe('custom_endpoint')
  })

  it('skips methods starting with $ or _', () => {
    const auth = {
      api: {
        $internal: async () => 'internal',
        _private: async () => 'private',
        getSession: async () => ({ user: { id: '1' } }),
      },
    } as Record<string, any>

    const original$internal = auth.api.$internal
    const original_private = auth.api._private

    instrumentBetterAuth(auth)

    // $ and _ prefixed methods should not be wrapped
    expect(auth.api.$internal).toBe(original$internal)
    expect(auth.api._private).toBe(original_private)
  })

  it('handles null/undefined auth gracefully', () => {
    expect(instrumentBetterAuth(null as any)).toBe(null)
    expect(instrumentBetterAuth(undefined as any)).toBe(undefined)
  })

  it('handles auth without api property', () => {
    const auth = { handler: () => {} } as Record<string, any>
    const result = instrumentBetterAuth(auth)
    expect(result).toBe(auth)
  })

  it('span output contains result for successful calls', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return auth.api.signOut()
    })

    const span = reqTrace.spans[0]!
    expect(span.output).toEqual({ success: true })
  })

  it('records multiple sequential api calls as separate spans', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      await auth.api.getSession({ headers: {} })
      await auth.api.signOut()
      await auth.api.updateUser({ body: { name: 'Alice' } })
    })

    expect(reqTrace.spans).toHaveLength(3)
    expect(reqTrace.spans[0]!.name).toBe('auth.api.get_session')
    expect(reqTrace.spans[1]!.name).toBe('auth.api.signout')
    expect(reqTrace.spans[2]!.name).toBe('auth.api.update_user')
  })

  it('result with .data wrapper extracts user correctly', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          data: {
            user: { id: 'nested-u', email: 'nested@test.com' },
            session: { id: 'nested-s' },
          },
        }),
      },
    } as Record<string, any>

    instrumentBetterAuth(auth)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return auth.api.getSession()
    })

    const attrs = reqTrace.spans[0]!.attributes!
    expect(attrs['user.id']).toBe('nested-u')
    expect(attrs['user.email']).toBe('nested@test.com')
    expect(attrs['session.id']).toBe('nested-s')
  })
})

describe('concurrent context isolation', () => {
  it('different withCtx calls record to separate traces', async () => {
    const { auth } = createMockAuth()
    instrumentBetterAuth(auth)

    const trace1 = new RequestTrace()
    const trace2 = new RequestTrace()

    await Promise.all([
      withCtx({ trace: trace1 }, async () => {
        return auth.api.getSession({ headers: {} })
      }),
      withCtx({ trace: trace2 }, async () => {
        return auth.api.signInEmail({ body: {} })
      }),
    ])

    expect(trace1.spans).toHaveLength(1)
    expect(trace1.spans[0]!.name).toBe('auth.api.get_session')
    expect(trace2.spans).toHaveLength(1)
    expect(trace2.spans[0]!.name).toBe('auth.api.signin')
  })
})
