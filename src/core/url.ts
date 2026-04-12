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
 */
export function parseUrlPath(url: string): string {
  const pathStart = url.indexOf('/', url.indexOf('//') + 2)
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
