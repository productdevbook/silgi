/**
 * RegExp Router — compile all routes into ONE regex.
 *
 * Technique from Hono's RegExpRouter:
 * 1. All routes → single regex with empty capture group markers
 * 2. path.match(regex) — single native C++ Irregexp call
 * 3. match.indexOf("", 1) — which route matched
 * 4. Params extracted from capture groups
 *
 * Faster than radix tree because regex engine runs in C++ (V8 Irregexp),
 * not interpreted JavaScript tree traversal.
 */

import type { MatchedRoute } from './types.ts'

interface RegExpRoute<T> {
  data: T
  paramNames: string[]
  paramOffset: number // index into match array where this route's params start
}

interface CompiledMatcher<T> {
  regex: RegExp
  routes: RegExpRoute<T>[]
  /** Direct lookup: marker capture group index → route */
  markerMap: Record<number, RegExpRoute<T>>
  staticMap: Record<string, { data: T }>
}

/**
 * RegExp Router builder — add routes, then compile into a single regex.
 */
export class RegExpRouter<T = unknown> {
  #routes: Array<{ method: string; path: string; data: T }> = []
  #matchers: Record<string, CompiledMatcher<T>> | null = null

  add(method: string, path: string, data: T): void {
    this.#routes.push({ method, path, data })
    this.#matchers = null // invalidate cache
  }

  match(method: string, path: string): MatchedRoute<T> | undefined {
    if (!this.#matchers) this.#matchers = this.#compile()

    // Normalize trailing slash
    if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
      path = path.slice(0, -1)
    }

    const matcher = this.#matchers[method] || this.#matchers['']
    if (!matcher) return undefined

    // Fast path: static route (O(1) map lookup)
    const staticMatch = matcher.staticMap[path]
    if (staticMatch) return staticMatch

    // Single regex match — C++ native Irregexp
    const m = path.match(matcher.regex)
    if (!m) return undefined

    // Find which route matched via empty capture group marker
    const idx = m.indexOf('', 1)
    if (idx === -1) return undefined

    // Direct index lookup — pre-computed map from marker index → route
    const route = matcher.markerMap[idx]
    if (!route) return undefined

    // Extract params
    if (route.paramNames.length === 0) {
      return { data: route.data }
    }

    const params: Record<string, string> = Object.create(null)
    for (let i = 0; i < route.paramNames.length; i++) {
      const val = m[route.paramOffset + i + 1]
      if (val !== undefined) {
        params[route.paramNames[i]!] = val
      }
    }
    return { data: route.data, params }
  }

  #compile(): Record<string, CompiledMatcher<T>> {
    const byMethod: Record<string, Array<{ path: string; data: T }>> = Object.create(null)

    for (const { method, path, data } of this.#routes) {
      const key = method || ''
      if (!byMethod[key]) byMethod[key] = []
      byMethod[key]!.push({ path, data })
    }

    const matchers: Record<string, CompiledMatcher<T>> = Object.create(null)

    for (const method in byMethod) {
      const entries = byMethod[method]!
      const routes: RegExpRoute<T>[] = []
      const staticMap: Record<string, { data: T }> = Object.create(null)
      const regexParts: string[] = []
      let captureIdx = 0

      for (const { path, data } of entries) {
        const isStatic = !path.includes(':') && !path.includes('*')

        if (isStatic) {
          const normalized = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
          staticMap[normalized] = { data }
          // Also add trailing slash variant
          if (normalized !== '/') staticMap[normalized + '/'] = { data }
          continue
        }

        const paramNames: string[] = []
        const paramOffset = captureIdx

        // Convert path to regex pattern
        const pattern = this.#pathToRegex(path, paramNames)
        captureIdx += paramNames.length

        // Add empty capture group as marker
        regexParts.push(`${pattern}()`)
        captureIdx++ // for the marker group

        routes.push({ data, paramNames, paramOffset })
      }

      const regex = regexParts.length > 0 ? new RegExp(`^(?:${regexParts.join('|')})$`) : /^$/

      // Pre-compute marker index → route map for O(1) lookup
      const markerMap: Record<number, RegExpRoute<T>> = Object.create(null)
      for (const route of routes) {
        markerMap[route.paramOffset + route.paramNames.length + 1] = route
      }

      matchers[method] = { regex, routes, markerMap, staticMap }
    }

    return matchers
  }

  #pathToRegex(path: string, paramNames: string[]): string {
    let pattern = ''
    const segments = path.split('/')

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      if (i === 0 && seg === '') continue // leading slash

      pattern += '\\/'

      if (seg === '**' || seg.startsWith('**:')) {
        // Catch-all wildcard
        const name = seg.startsWith('**:') ? seg.slice(3) : '_'
        paramNames.push(name)
        pattern += '(.*)'
        break
      }

      if (seg === '*') {
        // Single wildcard
        paramNames.push(String(paramNames.length))
        pattern += '([^/]*)'
        continue
      }

      if (seg.charCodeAt(0) === 58 /* : */) {
        // Named param
        let paramSeg = seg.slice(1)
        let optional = false
        let modifier: string | undefined

        // Check modifiers
        if (paramSeg.endsWith('?')) {
          optional = true
          paramSeg = paramSeg.slice(0, -1)
        } else if (paramSeg.endsWith('+')) {
          modifier = '+'
          paramSeg = paramSeg.slice(0, -1)
        } else if (paramSeg.endsWith('*')) {
          modifier = '*'
          paramSeg = paramSeg.slice(0, -1)
        }

        // Check regex constraint
        const parenIdx = paramSeg.indexOf('(')
        let name: string
        let constraint: string

        if (parenIdx !== -1) {
          name = paramSeg.slice(0, parenIdx)
          constraint = paramSeg.slice(parenIdx + 1, -1) // remove parens
        } else {
          name = paramSeg
          constraint = '[^/]+'
        }

        paramNames.push(name)

        if (modifier === '+') {
          // One or more segments
          pattern += `((?:${constraint})(?:\\/(?:${constraint}))*)`
          break
        }
        if (modifier === '*') {
          // Zero or more segments
          pattern += `((?:${constraint})(?:\\/(?:${constraint}))*)?`
          break
        }
        if (optional) {
          // Optional segment — match with or without
          pattern = pattern.slice(0, -2) // remove the \\/ we just added
          pattern += `(?:\\/(${constraint}))?`
        } else {
          pattern += `(${constraint})`
        }
        continue
      }

      // Static segment — escape regex chars
      pattern += seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    return pattern
  }
}
