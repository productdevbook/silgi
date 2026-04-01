import { useCallback, useEffect, useRef, useState } from 'react'

import type { AnalyticsData, ErrorEntry, RequestEntry, ScheduledTaskInfo, TaskExecution } from '@/lib/types'

const ENDPOINTS = {
  stats: '/api/analytics/stats',
  errors: '/api/analytics/errors?limit=500&sort=timestamp&order=desc',
  requests: '/api/analytics/requests?limit=500&sort=timestamp&order=desc',
  tasks: '/api/analytics/tasks?limit=500&sort=timestamp&order=desc',
  scheduled: '/api/analytics/scheduled',
  stream: '/api/analytics/stream',
} as const

const MAX_BUFFER = 2000

export function useAnalytics(intervalMs = 5000) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [taskExecutions, setTaskExecutions] = useState<TaskExecution[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskInfo[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const hasLoadedOnce = useRef(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Initial data fetch
  const fetchInitial = useCallback(async () => {
    try {
      if (!hasLoadedOnce.current) setIsLoading(true)
      const [apiRes, errRes, reqRes, taskRes] = await Promise.all([
        fetch(ENDPOINTS.stats, { cache: 'no-store' }),
        fetch(ENDPOINTS.errors, { cache: 'no-store' }),
        fetch(ENDPOINTS.requests, { cache: 'no-store' }),
        fetch(ENDPOINTS.tasks, { cache: 'no-store' }),
      ])

      if (apiRes.status === 401 || errRes.status === 401 || reqRes.status === 401 || taskRes.status === 401) {
        window.location.reload()
        return
      }

      if (!apiRes.ok || !errRes.ok || !reqRes.ok || !taskRes.ok) throw new Error('Failed to fetch analytics data')

      const [newData, errBody, reqBody, taskBody] = await Promise.all([
        apiRes.json(),
        errRes.json(),
        reqRes.json(),
        taskRes.json(),
      ])
      setData(newData)
      setErrors(Array.isArray(errBody) ? errBody : (errBody.data ?? []))
      setRequests(Array.isArray(reqBody) ? reqBody : (reqBody.data ?? []))
      setTaskExecutions(Array.isArray(taskBody) ? taskBody : (taskBody.data ?? []))
      const schedRes = await fetch(ENDPOINTS.scheduled, { cache: 'no-store' }).catch(() => null)
      if (schedRes?.ok) setScheduledTasks(await schedRes.json())
      setError(null)
      hasLoadedOnce.current = true
    } catch {
      setError('Analytics verisi alinamadi. Son basarili durum korunuyor.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // SSE connection for real-time updates
  useEffect(() => {
    if (!autoRefresh) {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      setConnected(false)
      return
    }

    // Initial fetch
    fetchInitial()

    // Connect SSE
    const es = new EventSource(ENDPOINTS.stream)
    eventSourceRef.current = es

    es.addEventListener('open', () => setConnected(true))

    es.addEventListener('request', (e) => {
      try {
        const entry = JSON.parse(e.data) as RequestEntry
        setRequests((prev) => [entry, ...prev].slice(0, MAX_BUFFER))
      } catch {}
    })

    es.addEventListener('error', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as ErrorEntry
        setErrors((prev) => [entry, ...prev].slice(0, MAX_BUFFER))
      } catch {
        // SSE connection error, not a data error
        setConnected(false)
      }
    })

    es.addEventListener('task', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as TaskExecution
        setTaskExecutions((prev) => [entry, ...prev].slice(0, MAX_BUFFER))
      } catch {}
    })

    es.addEventListener('stats', (e) => {
      try {
        const stats = JSON.parse((e as MessageEvent).data) as AnalyticsData
        setData(stats)
      } catch {}
    })

    // Fallback polling for stats (in case SSE stats broadcast is slow)
    const statsTimer = setInterval(async () => {
      try {
        const res = await fetch(ENDPOINTS.stats, { cache: 'no-store' })
        if (res.ok) setData(await res.json())
      } catch {}
    }, intervalMs)

    return () => {
      es.close()
      eventSourceRef.current = null
      setConnected(false)
      clearInterval(statsTimer)
    }
  }, [autoRefresh, fetchInitial, intervalMs])

  return {
    data,
    errors,
    requests,
    taskExecutions,
    scheduledTasks,
    autoRefresh,
    setAutoRefresh,
    error,
    isLoading,
    connected,
  } as const
}
