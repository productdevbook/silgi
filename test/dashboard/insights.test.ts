import { describe, expect, it } from 'vitest'

import { getOverviewInsights } from '../../dashboard/src/lib/insights'
import { mockData } from '../../dashboard/src/lib/mock-data'

describe('getOverviewInsights', () => {
  it('returns an empty waiting state when no data is available', () => {
    const insights = getOverviewInsights(null)

    expect(insights.health.label).toBe('Waiting for traffic')
    expect(insights.busiest).toBeNull()
    expect(insights.noisiest).toBeNull()
    expect(insights.slowest).toBeNull()
    expect(insights.procedureCount).toBe(0)
  })

  it('derives busiest, noisiest, and slowest procedures from analytics data', () => {
    const insights = getOverviewInsights(mockData)

    expect(insights.health.tone).toBe('healthy')
    expect(insights.busiest?.path).toBe('todos/list')
    expect(insights.busiest?.value).toBe(5230)
    expect(insights.noisiest?.path).toBe('todos/create')
    expect(insights.noisiest?.value).toBe(8)
    expect(insights.slowest?.path).toBe('todos/create')
    expect(insights.slowest?.value).toBe(35.2)
    expect(insights.procedureCount).toBe(5)
  })

  it('escalates health tone when errors or latency cross thresholds', () => {
    const degraded = getOverviewInsights({
      ...mockData,
      errorRate: 1.4,
    })
    const critical = getOverviewInsights({
      ...mockData,
      avgLatency: 320,
    })

    expect(degraded.health.tone).toBe('degraded')
    expect(critical.health.tone).toBe('critical')
  })
})
