/**
 * Router utilities — path parsing, segment splitting.
 */

/** Split path into segments. '/users/list' → ['users', 'list'] */
export function splitPath(path: string): string[] {
  if (path.charCodeAt(0) === 47 /* '/' */) path = path.slice(1)
  if (path.length === 0) return []
  if (path.charCodeAt(path.length - 1) === 47) path = path.slice(0, -1)
  return path.split('/')
}

/** Normalize path — ensure leading slash, handle edge cases */
export function normalizePath(path: string): string {
  if (path.charCodeAt(0) !== 47) path = '/' + path
  // Remove trailing slash (except root)
  if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
    path = path.slice(0, -1)
  }
  return path
}

/** Check if a segment is a param (starts with ':') */
export function isParam(segment: string): boolean {
  return segment.charCodeAt(0) === 58 /* ':' */
}

/** Check if a segment is a wildcard ('*' or '**') */
export function isWildcard(segment: string): boolean {
  return segment === '*' || segment === '**' || segment.startsWith('**:')
}

/** Check if segment is a catch-all wildcard ('**' or '**:name') */
export function isCatchAll(segment: string): boolean {
  return segment === '**' || segment.startsWith('**:')
}

/**
 * Parse a param segment into name and optional regex constraint.
 * ':id' → { name: 'id' }
 * ':id(\\d+)' → { name: 'id', regex: /^\d+$/ }
 * ':id?' → { name: 'id', optional: true }
 */
export function parseParam(segment: string): {
  name: string
  regex?: RegExp
  optional: boolean
  modifier?: '+' | '*'
} {
  // Remove leading ':'
  let s = segment.slice(1)

  // Check modifiers at end
  let optional = false
  let modifier: '+' | '*' | undefined

  if (s.endsWith('?')) {
    optional = true
    s = s.slice(0, -1)
  } else if (s.endsWith('+')) {
    modifier = '+'
    s = s.slice(0, -1)
  } else if (s.endsWith('*')) {
    modifier = '*'
    optional = true
    s = s.slice(0, -1)
  }

  // Check for regex constraint
  const parenIdx = s.indexOf('(')
  if (parenIdx !== -1) {
    const name = s.slice(0, parenIdx)
    const pattern = s.slice(parenIdx + 1, -1) // remove parens
    return { name, regex: new RegExp(`^${pattern}$`), optional }
  }

  return { name: s, optional, modifier }
}

/** Extract params from matched segments using a param map */
export function extractParams(
  segments: string[],
  paramMap: Array<[number, string | RegExp, boolean]>,
): Record<string, string> {
  const params: Record<string, string> = Object.create(null)
  for (let i = 0; i < paramMap.length; i++) {
    const [idx, name, _optional] = paramMap[i]!
    const value = segments[idx]
    if (value !== undefined) {
      params[typeof name === 'string' ? name : String(i)] = value
    }
  }
  return params
}
