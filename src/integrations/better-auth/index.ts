/**
 * Silgi + Better Auth tracing integration.
 *
 * Provides a Better Auth plugin factory that auto-traces all auth operations
 * (sign-in, sign-up, OAuth, session management, etc.) into silgi analytics.
 *
 * The silgi request context is passed via `request.__silgiCtx`, set by
 * the silgi auth handler before calling `auth.handler(request)`.
 *
 * @example
 * ```ts
 * import { tracing } from 'silgi/better-auth'
 *
 * const auth = betterAuth({
 *   plugins: [
 *     tracing(),  // auto-traces all auth operations
 *   ],
 * })
 * ```
 */
import { getCtx, runWithCtx } from '../../core/context-bridge.ts'

import type { RequestTrace, SpanKind, TraceSpan } from '../../plugins/analytics.ts'

// ── Types ────────────────────────────────────────────

export interface TracingConfig {
  /** Capture request body as span input (default: true) */
  captureInput?: boolean
  /** Capture response data as span output (default: true) */
  captureOutput?: boolean
  /** Pass `createAuthMiddleware` from `better-auth/api` to wrap hooks handler */
  createAuthMiddleware?: (handler: any) => any
}

interface RequestMeta {
  startTime: number
  path: string
  operation: string
  method: string | undefined
  provider: string | undefined
  spanName: string
}

interface OperationMatch {
  spanName: string
  operation: string
  method?: string
  provider?: string
}

// ── Path Matching ────────────────────────────────────

function matchOperation(path: string): OperationMatch {
  // Normalize: strip leading slashes, work with the tail segments
  const normalized = path.replace(/^\/+/, '')

  if (normalized.endsWith('/sign-up/email') || normalized === 'sign-up/email') {
    return { spanName: 'auth.signup.email', operation: 'signup', method: 'email' }
  }
  if (normalized.endsWith('/sign-in/email') || normalized === 'sign-in/email') {
    return { spanName: 'auth.signin.email', operation: 'signin', method: 'email' }
  }
  if (normalized.endsWith('/sign-out') || normalized === 'sign-out') {
    return { spanName: 'auth.signout', operation: 'signout' }
  }
  if (normalized.endsWith('/get-session') || normalized === 'get-session') {
    return { spanName: 'auth.get_session', operation: 'get_session' }
  }
  if (normalized.endsWith('/update-user') || normalized === 'update-user') {
    return { spanName: 'auth.update_user', operation: 'update_user' }
  }
  if (normalized.endsWith('/delete-user') || normalized === 'delete-user') {
    return { spanName: 'auth.delete_user', operation: 'delete_user' }
  }
  if (normalized.endsWith('/change-password') || normalized === 'change-password') {
    return { spanName: 'auth.change_password', operation: 'change_password' }
  }
  if (normalized.endsWith('/change-email') || normalized === 'change-email') {
    return { spanName: 'auth.change_email', operation: 'change_email' }
  }
  if (normalized.endsWith('/verify-email') || normalized === 'verify-email') {
    return { spanName: 'auth.verify_email', operation: 'verify_email' }
  }
  if (normalized.endsWith('/forget-password') || normalized === 'forget-password') {
    return { spanName: 'auth.forgot_password', operation: 'forgot_password' }
  }
  if (normalized.endsWith('/reset-password') || normalized === 'reset-password') {
    return { spanName: 'auth.reset_password', operation: 'reset_password' }
  }
  if (normalized.endsWith('/list-sessions') || normalized === 'list-sessions') {
    return { spanName: 'auth.list_sessions', operation: 'list_sessions' }
  }
  if (normalized.endsWith('/revoke-session') || normalized === 'revoke-session') {
    return { spanName: 'auth.revoke_session', operation: 'revoke_session' }
  }

  // OAuth callback: */callback/{provider}
  const callbackMatch = normalized.match(/\/callback\/([^/?]+)/)
  if (callbackMatch) {
    const provider = callbackMatch[1]!
    return {
      spanName: `auth.oauth.callback.${provider}`,
      operation: 'oauth_callback',
      method: 'oauth',
      provider,
    }
  }

  // OAuth sign-in: */sign-in/{provider} (not email)
  const signinMatch = normalized.match(/\/sign-in\/([^/?]+)$/)
  if (signinMatch && signinMatch[1] !== 'email') {
    const provider = signinMatch[1]!
    return {
      spanName: `auth.oauth.initiate.${provider}`,
      operation: 'oauth_initiate',
      method: 'oauth',
      provider,
    }
  }

  // Fallback: extract last path segment
  const segments = normalized.split('/')
  const last = segments[segments.length - 1] || 'unknown'
  const slug = last.replace(/-/g, '_')
  return { spanName: `auth.${slug}`, operation: 'unknown' }
}

// ── Helpers ──────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function extractUserData(returned: any): { userId?: string; userEmail?: string; sessionId?: string } {
  const result: { userId?: string; userEmail?: string; sessionId?: string } = {}
  if (!returned || typeof returned !== 'object') return result

  // Try returned.data (Better Fetch response format)
  const data = returned.data ?? returned

  if (data.user?.id) result.userId = String(data.user.id)
  if (data.user?.email) result.userEmail = String(data.user.email)
  if (data.session?.id) result.sessionId = String(data.session.id)

  // Also check top-level (direct API format)
  if (!result.userId && returned.id && returned.email) {
    result.userId = String(returned.id)
    result.userEmail = String(returned.email)
  }

  return result
}

// ── WeakMap for per-request metadata ─────────────────

const requestMetas = new WeakMap<Request, RequestMeta>()

// ── Plugin Factory ───────────────────────────────────

/**
 * Creates a Better Auth plugin that auto-traces all auth operations
 * into silgi analytics spans.
 *
 * @param config - Optional configuration
 * @returns A Better Auth plugin (typed as `any` to avoid requiring better-auth types at build time)
 */
export function tracing(config?: TracingConfig): any {
  const captureInput = config?.captureInput ?? true
  const captureOutput = config?.captureOutput ?? true
  const wrapMiddleware = config?.createAuthMiddleware ?? ((fn: any) => fn)

  return {
    id: 'silgi-tracing',

    onRequest: async (request: Request, _ctx: any) => {
      try {
        const url = new URL(request.url)
        const path = url.pathname
        const match = matchOperation(path)

        requestMetas.set(request, {
          startTime: performance.now(),
          path,
          operation: match.operation,
          method: match.method,
          provider: match.provider,
          spanName: match.spanName,
        })
      } catch {
        // Silently ignore — tracing should never break auth
      }
    },

    hooks: {
      after: [
        {
          matcher: () => true,
          handler: wrapMiddleware(async (ctx: any) => {
            try {
              const request = ctx.request as Request | undefined
              if (!request) return

              const silgiCtx = ((request as any).__silgiCtx ?? getCtx()) as Record<string, unknown> | undefined
              if (!silgiCtx) return

              const reqTrace = silgiCtx.trace as RequestTrace | undefined
              if (!reqTrace) return

              // Get timing from onRequest, or fallback
              const meta = requestMetas.get(request)
              requestMetas.delete(request)

              const path = ctx.path || ''
              const match = meta
                ? { spanName: meta.spanName, operation: meta.operation, method: meta.method, provider: meta.provider }
                : matchOperation(path)
              const startTime = meta?.startTime ?? performance.now()
              const durationMs = round(performance.now() - startTime)

              // Extract user/session data
              const returned = ctx.context?.returned
              const newSession = ctx.context?.newSession
              const userData = extractUserData(returned)

              if (!userData.userId && newSession?.user?.id) userData.userId = String(newSession.user.id)
              if (!userData.userEmail && newSession?.user?.email) userData.userEmail = String(newSession.user.email)
              if (!userData.sessionId && newSession?.session?.id) userData.sessionId = String(newSession.session.id)

              const success = !returned?.error && !ctx.context?.error
              const attributes: Record<string, string | number | boolean> = {
                'auth.operation': match.operation,
                'auth.success': success,
              }
              if (match.method) attributes['auth.method'] = match.method
              if (match.provider) attributes['auth.provider'] = match.provider
              if (userData.userId) attributes['user.id'] = userData.userId
              if (userData.userEmail) attributes['user.email'] = userData.userEmail
              if (userData.sessionId) attributes['session.id'] = userData.sessionId

              const span: TraceSpan = {
                name: match.spanName,
                kind: 'http' as SpanKind,
                durationMs,
                startOffsetMs: round(startTime - reqTrace.t0),
                attributes,
              }

              if (captureInput && ctx.body) span.input = ctx.body
              if (captureOutput && returned && typeof returned === 'object') span.output = returned
              if (!success && returned?.error) {
                span.error = typeof returned.error === 'string' ? returned.error : (returned.error?.message ?? 'error')
              }

              reqTrace.spans.push(span)

              // Procedure-level input/output
              if (captureInput && ctx.body) reqTrace.procedureInput = ctx.body
              if (captureOutput && returned && typeof returned === 'object') reqTrace.procedureOutput = returned
            } catch {
              // Silently ignore
            }
          }),
        },
      ],
    },
  }
}

// ── API Method Metadata ─────────────────────────────

const API_METHOD_METADATA: Record<string, { operation: string; method?: string }> = {
  getSession: { operation: 'get_session' },
  signOut: { operation: 'signout' },
  signInEmail: { operation: 'signin', method: 'email' },
  signUpEmail: { operation: 'signup', method: 'email' },
  signInSocial: { operation: 'signin', method: 'oauth' },
  callbackOAuth: { operation: 'oauth_callback', method: 'oauth' },
  linkSocialAccount: { operation: 'link_social_account', method: 'oauth' },
  unlinkAccount: { operation: 'unlink_account' },
  listUserAccounts: { operation: 'list_user_accounts' },
  updateUser: { operation: 'update_user' },
  deleteUser: { operation: 'delete_user' },
  changePassword: { operation: 'change_password' },
  setPassword: { operation: 'set_password' },
  changeEmail: { operation: 'change_email' },
  verifyEmail: { operation: 'verify_email' },
  sendVerificationEmail: { operation: 'send_verification_email' },
  forgetPassword: { operation: 'forget_password' },
  resetPassword: { operation: 'reset_password' },
  listSessions: { operation: 'list_sessions' },
  revokeSession: { operation: 'revoke_session' },
  revokeSessions: { operation: 'revoke_sessions' },
  revokeOtherSessions: { operation: 'revoke_other_sessions' },
  refreshToken: { operation: 'refresh_token' },
  getAccessToken: { operation: 'get_access_token' },
}

// ── instrumentBetterAuth ────────────────────────────

const AUTH_INSTRUMENTED = '__silgiBetterAuthInstrumented'

/**
 * Instrument a Better Auth instance to trace all `auth.api.*` method calls.
 * Works with `withCtx` — programmatic calls from background jobs,
 * server-side session fetches etc. are traced when context is available.
 *
 * @example
 * ```ts
 * import { instrumentBetterAuth, withCtx } from 'silgi/better-auth'
 *
 * const auth = instrumentBetterAuth(betterAuth({ ... }))
 *
 * // In a silgi procedure:
 * const me = s.$resolve(async ({ ctx }) => {
 *   return withCtx(ctx, () => auth.api.getSession({ headers: ctx.headers }))
 * })
 * ```
 */
export function instrumentBetterAuth<T extends Record<string, any>>(auth: T): T {
  if (!auth || (auth as any)[AUTH_INSTRUMENTED]) return auth

  const api = (auth as any).api as Record<string, any> | undefined
  if (!api || typeof api !== 'object') return auth

  const instrumented = new Set<string>()

  // Known methods with specific metadata
  for (const [methodName, metadata] of Object.entries(API_METHOD_METADATA)) {
    if (typeof api[methodName] === 'function') {
      api[methodName] = wrapApiMethod(api[methodName], metadata.operation, metadata.method)
      instrumented.add(methodName)
    }
  }

  // Unknown methods — generic wrapping
  for (const key of Object.keys(api)) {
    if (typeof api[key] === 'function' && !instrumented.has(key) && !key.startsWith('$') && !key.startsWith('_')) {
      const operation = key
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
      api[key] = wrapApiMethod(api[key], operation)
      instrumented.add(key)
    }
  }

  ;(auth as any)[AUTH_INSTRUMENTED] = true
  return auth
}

/**
 * Run a function with silgi context available to instrumented Better Auth API calls.
 */
export function withCtx<T>(ctx: Record<string, unknown>, fn: () => T): T {
  return runWithCtx(ctx, fn)
}

function wrapApiMethod(
  originalFn: (...args: any[]) => Promise<any>,
  operation: string,
  method?: string,
): (...args: any[]) => Promise<any> {
  return async function instrumented(this: any, ...args: any[]): Promise<any> {
    const ctx = getCtx()
    const reqTrace = ctx?.trace as RequestTrace | undefined

    if (!reqTrace) return originalFn.apply(this, args)

    const spanName = `auth.api.${operation}`
    const start = performance.now()
    const attributes: Record<string, string | number | boolean> = {
      'auth.operation': operation,
      'auth.success': true,
    }
    if (method) attributes['auth.method'] = method

    try {
      const result = await originalFn.apply(this, args)

      // Extract user/session from result
      const data = result?.data ?? result
      if (data?.user?.id) attributes['user.id'] = String(data.user.id)
      if (data?.user?.email) attributes['user.email'] = String(data.user.email)
      if (data?.session?.id) attributes['session.id'] = String(data.session.id)

      if (result?.error) {
        attributes['auth.success'] = false
        attributes['auth.error'] =
          typeof result.error === 'string' ? result.error : (result.error?.message ?? 'unknown')
      }

      reqTrace.spans.push({
        name: spanName,
        kind: 'http' as SpanKind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - reqTrace.t0),
        attributes,
        output: result && typeof result === 'object' ? result : undefined,
      })

      return result
    } catch (error) {
      attributes['auth.success'] = false
      attributes['auth.error'] = error instanceof Error ? error.message : String(error)

      reqTrace.spans.push({
        name: spanName,
        kind: 'http' as SpanKind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - reqTrace.t0),
        attributes,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      })

      throw error
    }
  }
}
