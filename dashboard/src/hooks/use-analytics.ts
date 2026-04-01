import { useCallback, useEffect, useRef, useState } from 'react'

import type { AnalyticsData, ErrorEntry, RequestEntry, ScheduledTaskInfo, TaskExecution } from '@/lib/types'

const ENDPOINTS = {
  stats: '/api/analytics/stats',
  errors: '/api/analytics/errors?limit=10000',
  requests: '/api/analytics/requests?limit=10000',
  tasks: '/api/analytics/tasks?limit=10000',
  scheduled: '/api/analytics/scheduled',
} as const

export function useAnalytics(intervalMs = 2000) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [taskExecutions, setTaskExecutions] = useState<TaskExecution[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskInfo[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const inFlight = useRef(false)
  const hasLoadedOnce = useRef(false)

  const poll = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true

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
      setErrors(errBody.data ?? errBody)
      setRequests(reqBody.data ?? reqBody)
      setTaskExecutions(taskBody.data ?? taskBody)
      const schedRes = await fetch(ENDPOINTS.scheduled, { cache: 'no-store' }).catch(() => null)
      if (schedRes?.ok) setScheduledTasks(await schedRes.json())
      setError(null)
      hasLoadedOnce.current = true
    } catch {
      setError('Analytics verisi alinamadi. Son basarili durum korunuyor.')
    } finally {
      setIsLoading(false)
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    poll()
    if (!autoRefresh) return
    const timer = setInterval(poll, intervalMs)
    return () => clearInterval(timer)
  }, [poll, intervalMs, autoRefresh])

  return { data, errors, requests, taskExecutions, scheduledTasks, autoRefresh, setAutoRefresh, error, isLoading } as const
}
