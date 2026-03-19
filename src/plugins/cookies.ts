/**
 * Cookie helpers — parse, set, and delete cookies.
 *
 * Lightweight utilities for working with cookies in Katman handlers.
 * No dependencies. Works with both serve() and handler().
 *
 * @example
 * ```ts
 * import { getCookie, setCookie, deleteCookie } from "katman/cookies"
 *
 * const auth = k.guard((ctx) => {
 *   const token = getCookie(ctx.headers, "session")
 *   if (!token) throw new KatmanError("UNAUTHORIZED")
 *   return { sessionToken: token }
 * })
 * ```
 */

/** Parse a specific cookie from a headers object or cookie string. */
export function getCookie(headers: Record<string, string> | string, name: string): string | undefined {
  const cookieStr = typeof headers === 'string' ? headers : (headers.cookie ?? headers.Cookie ?? '')
  if (!cookieStr) return undefined

  const prefix = `${name}=`
  const cookies = cookieStr.split(';')
  for (let i = 0; i < cookies.length; i++) {
    const c = cookies[i]!.trim()
    if (c.startsWith(prefix)) {
      return decodeURIComponent(c.slice(prefix.length))
    }
  }
  return undefined
}

/** Parse all cookies from a headers object or cookie string. */
export function parseCookies(headers: Record<string, string> | string): Record<string, string> {
  const cookieStr = typeof headers === 'string' ? headers : (headers.cookie ?? headers.Cookie ?? '')
  if (!cookieStr) return {}

  const result: Record<string, string> = {}
  const cookies = cookieStr.split(';')
  for (let i = 0; i < cookies.length; i++) {
    const c = cookies[i]!.trim()
    const eq = c.indexOf('=')
    if (eq === -1) continue
    const key = c.slice(0, eq)
    const value = c.slice(eq + 1)
    result[key] = decodeURIComponent(value)
  }
  return result
}

export interface CookieOptions {
  /** Cookie expiry in seconds from now. */
  maxAge?: number
  /** Absolute expiry date. */
  expires?: Date
  /** Cookie path. Default: "/" */
  path?: string
  /** Cookie domain. */
  domain?: string
  /** HTTPS only. Default: true in production. */
  secure?: boolean
  /** Prevent JavaScript access. Default: true */
  httpOnly?: boolean
  /** SameSite policy. Default: "lax" */
  sameSite?: 'strict' | 'lax' | 'none'
}

/** Serialize a Set-Cookie header value. */
export function setCookie(name: string, value: string, options: CookieOptions = {}): string {
  const { path = '/', httpOnly = true, secure, sameSite = 'lax', maxAge, expires, domain } = options

  let cookie = `${name}=${encodeURIComponent(value)}`
  if (path) cookie += `; Path=${path}`
  if (domain) cookie += `; Domain=${domain}`
  if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`
  if (expires) cookie += `; Expires=${expires.toUTCString()}`
  if (httpOnly) cookie += '; HttpOnly'
  if (
    secure ??
    (sameSite === 'none' ||
      (typeof globalThis.process !== 'undefined' && globalThis.process.env?.NODE_ENV === 'production'))
  ) {
    cookie += '; Secure'
  }
  cookie += `; SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1)}`

  return cookie
}

/** Create a Set-Cookie header that deletes a cookie. */
export function deleteCookie(name: string, options: Pick<CookieOptions, 'path' | 'domain'> = {}): string {
  return setCookie(name, '', { ...options, maxAge: 0 })
}
