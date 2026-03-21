import { useCallback, useEffect, useState } from 'react'

export interface Route {
  page: string
  id?: string
}

function parseHash(): Route {
  const hash = window.location.hash.slice(1) || '/'
  const parts = hash.split('/').filter(Boolean)
  if (parts.length === 0) return { page: 'overview' }
  if (parts.length === 2) return { page: parts[0]!, id: parts[1] }
  return { page: parts[0]! }
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((page: string, id?: string) => {
    window.location.hash = id ? `${page}/${id}` : page
  }, [])

  return { route, navigate }
}
