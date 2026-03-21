import { mockData, mockErrors, mockRequests } from '@/lib/mock-data'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AnalyticsData, ErrorEntry, RequestEntry } from '@/lib/types'

const ENDPOINTS = {
  stats: '/analytics/_api/stats',
  errors: '/analytics/_api/errors',
  requests: '/analytics/_api/requests',
} as const

export function useAnalytics(intervalMs = 2000) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const useMock = useRef(false)

  const poll = useCallback(async () => {
    if (useMock.current) return

    try {
      const [apiRes, errRes, reqRes] = await Promise.all([
        fetch(ENDPOINTS.stats),
        fetch(ENDPOINTS.errors),
        fetch(ENDPOINTS.requests),
      ])

      // 401 = token expired or removed, reload to show server-side login page
      if (apiRes.status === 401 || errRes.status === 401 || reqRes.status === 401) {
        window.location.reload()
        return
      }

      if (!apiRes.ok || !errRes.ok || !reqRes.ok) {
        fallbackToMock()
        return
      }

      setData(await apiRes.json())
      setErrors(await errRes.json())
      setRequests(await reqRes.json())
    } catch {
      fallbackToMock()
    }
  }, [])

  function fallbackToMock() {
    useMock.current = true
    setData(mockData)
    setErrors(mockErrors)
    setRequests(mockRequests)
    setAutoRefresh(false)
  }

  useEffect(() => {
    poll()
    if (!autoRefresh || useMock.current) return
    const timer = setInterval(poll, intervalMs)
    return () => clearInterval(timer)
  }, [poll, intervalMs, autoRefresh])

  return { data, errors, requests, autoRefresh, setAutoRefresh } as const
}
