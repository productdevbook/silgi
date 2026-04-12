/**
 * Cookie helpers — thin wrapper over cookie-es (unjs).
 *
 * @example
 * ```ts
 * import { getCookie, setCookie, deleteCookie } from "silgi/cookies"
 *
 * const auth = k.guard((ctx) => {
 *   const token = getCookie(ctx.headers, "session")
 *   if (!token) throw new SilgiError("UNAUTHORIZED")
 *   return { sessionToken: token }
 * })
 * ```
 */

import { parse, serialize } from 'cookie-es'

import type { CookieSerializeOptions } from 'cookie-es'

export type CookieOptions = CookieSerializeOptions

/** Parse a specific cookie value by name. */
export function getCookie(headers: Record<string, string> | string, name: string): string | undefined {
  const str = typeof headers === 'string' ? headers : (headers.cookie ?? headers.Cookie ?? '')
  if (!str) return undefined
  return parse(str)[name]
}

/** Parse all cookies into a key-value object. */
export function parseCookies(headers: Record<string, string> | string): Record<string, string> {
  const str = typeof headers === 'string' ? headers : (headers.cookie ?? headers.Cookie ?? '')
  if (!str) return {}
  return parse(str) as Record<string, string>
}

/** Serialize a Set-Cookie header. Defaults: path="/", httpOnly, sameSite=lax. */
export function setCookie(name: string, value: string, options: CookieOptions = {}): string {
  const defaults: CookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' }
  const merged = { ...defaults, ...options }
  // SameSite=None requires Secure per RFC 6265bis — enforce after merge so callers can't override
  if (merged.sameSite === 'none') merged.secure = true
  return serialize(name, value, merged)
}

/** Delete a cookie by setting maxAge=0. */
export function deleteCookie(name: string, options: Pick<CookieOptions, 'path' | 'domain'> = {}): string {
  return setCookie(name, '', { ...options, maxAge: 0 })
}

export { parseSetCookie, splitSetCookieString } from 'cookie-es'
