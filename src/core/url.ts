/**
 * URL path extraction — fast, no URL constructor.
 *
 * Shared by handler.ts and analytics to avoid duplicating
 * the manual indexOf-based path parsing logic.
 */

/**
 * Extract the full path (with leading slash) from a URL string.
 * Returns the path portion without query string.
 *
 * Uses manual indexOf — no `new URL()` overhead.
 *
 * @remarks
 * Handles both absolute URLs (`http://host/path?q`) and bare paths
 * (`/path?q`). The latter shape is produced by adapters that strip the
 * origin before calling the handler, and by test harnesses constructing
 * synthetic requests. Without the bare-path branch, a missing `//`
 * caused `indexOf('//') + 2 = 1` and `indexOf('/', 1)` returned a bogus
 * offset that silently produced the wrong path.
 */
export function parseUrlPath(url: string): string {
  // Bare-path fast path — no scheme, no authority.
  if (url.length > 0 && url.charCodeAt(0) === 47 /* '/' */) {
    const qMark = url.indexOf('?')
    return qMark === -1 ? url : url.slice(0, qMark)
  }
  const schemeEnd = url.indexOf('//')
  if (schemeEnd === -1) {
    // Not a URL we can parse — treat the whole string as the path.
    const qMark = url.indexOf('?')
    return qMark === -1 ? url : url.slice(0, qMark)
  }
  const pathStart = url.indexOf('/', schemeEnd + 2)
  if (pathStart === -1) {
    // URL with authority but no path (e.g. `http://host`). Treat as root.
    return '/'
  }
  const qMark = url.indexOf('?', pathStart)
  return qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
}

/**
 * Extract pathname without leading slash from a URL string.
 * Used for route matching where paths are slash-stripped.
 */
export function parseUrlPathname(url: string): string {
  const fullPath = parseUrlPath(url)
  return fullPath.length > 1 ? fullPath.slice(1) : ''
}

/** Normalize a basePath: ensure leading slash, strip trailing slash. */
export function normalizePrefix(basePath: string): string {
  let p = basePath.startsWith('/') ? basePath : '/' + basePath
  if (p.endsWith('/')) p = p.slice(0, -1)
  return p
}
