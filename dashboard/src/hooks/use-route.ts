import { useCallback, useEffect, useState } from 'react'

export interface Route {
  page: string
  id?: string
  params: Record<string, string>
}

function parseHash(): Route {
  const raw = window.location.hash.slice(1) || '/'
  const [path = '/', search = ''] = raw.split('?')
  const parts = path.split('/').filter(Boolean)

  const params: Record<string, string> = {}
  if (search) {
    for (const pair of search.split('&')) {
      const [k, v] = pair.split('=')
      if (k) params[k] = decodeURIComponent(v ?? '')
    }
  }

  if (parts.length === 0) return { page: 'overview', params }
  if (parts.length === 2) return { page: parts[0]!, id: parts[1], params }
  return { page: parts[0]!, params }
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((page: string, id?: string, params?: Record<string, string>) => {
    let hash = id ? `${page}/${id}` : page
    if (params) {
      const qs = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
      if (qs) hash += `?${qs}`
    }
    window.location.hash = hash
  }, [])

  return { route, navigate }
}
