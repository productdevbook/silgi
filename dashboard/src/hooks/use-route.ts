import { useCallback, useEffect, useState } from 'react'

export interface Route {
  page: string
  id?: string
  params: Record<string, string>
}

const KNOWN_PAGES = new Set(['overview', 'requests', 'errors', 'tasks', 'sessions'])

function parseHash(): Route {
  const raw = window.location.hash.slice(1) || '/'
  const [path = '/', search = ''] = raw.split('?', 2)
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))

  const params: Record<string, string> = {}
  const searchParams = new URLSearchParams(search)
  for (const [key, value] of searchParams.entries()) {
    params[key] = value
  }

  if (parts.length === 0) return { page: 'overview', params }

  const page = KNOWN_PAGES.has(parts[0]!) ? parts[0]! : 'overview'
  const id = parts.length >= 2 ? parts[1] : undefined

  return { page, id, params }
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((page: string, id?: string, params?: Record<string, string>) => {
    const normalizedPage = KNOWN_PAGES.has(page) ? page : 'overview'
    let hash = id ? `${normalizedPage}/${encodeURIComponent(id)}` : normalizedPage
    if (params) {
      const qs = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        qs.set(key, value)
      }
      const search = qs.toString()
      if (search) hash += `?${search}`
    }
    window.location.hash = hash
  }, [])

  return { route, navigate }
}
