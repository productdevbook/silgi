import { mockData, mockErrors, mockRequests } from '@/lib/mock-data'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AnalyticsData, ErrorEntry, RequestEntry, TaskExecution } from '@/lib/types'

const ENDPOINTS = {
  stats: '/analytics/_api/stats',
  errors: '/analytics/_api/errors',
  requests: '/analytics/_api/requests',
  tasks: '/analytics/_api/tasks',
} as const

export function useAnalytics(intervalMs = 2000) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [taskExecutions, setTaskExecutions] = useState<TaskExecution[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const useMock = useRef(false)

  const poll = useCallback(async () => {
    if (useMock.current) return

    try {
      const [apiRes, errRes, reqRes, taskRes] = await Promise.all([
        fetch(ENDPOINTS.stats),
        fetch(ENDPOINTS.errors),
        fetch(ENDPOINTS.requests),
        fetch(ENDPOINTS.tasks),
      ])

      if (apiRes.status === 401 || errRes.status === 401 || reqRes.status === 401) {
        window.location.reload()
        return
      }

      if (!apiRes.ok || !errRes.ok || !reqRes.ok) {
        fallbackToMock()
        return
      }

      const [newData, newErrors, newRequests] = await Promise.all([apiRes.json(), errRes.json(), reqRes.json()])
      setData(newData)
      setErrors(newErrors)
      setRequests(newRequests)
      if (taskRes.ok) setTaskExecutions(await taskRes.json())
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
    if (useMock.current) return
    poll()
    if (!autoRefresh) return
    const timer = setInterval(poll, intervalMs)
    return () => clearInterval(timer)
  }, [poll, intervalMs, autoRefresh])

  return { data, errors, requests, taskExecutions, autoRefresh, setAutoRefresh } as const
}
