import type { AnalyticsData } from './types'

export type HealthTone = 'healthy' | 'degraded' | 'critical'

export interface ProcedureInsight {
  path: string
  value: number
  meta: string
}

export interface OverviewInsights {
  health: {
    tone: HealthTone
    label: string
    description: string
  }
  busiest: ProcedureInsight | null
  noisiest: ProcedureInsight | null
  slowest: ProcedureInsight | null
  procedureCount: number
}

export interface OverviewFocusItem {
  path: string
  value: string
  meta: string
  tone: 'default' | 'secondary' | 'destructive'
}

export interface ProcedureFocusLists {
  traffic: OverviewFocusItem[]
  latency: OverviewFocusItem[]
  failures: OverviewFocusItem[]
}

export function getOverviewInsights(data: AnalyticsData | null): OverviewInsights {
  if (!data) {
    return {
      health: {
        tone: 'healthy',
        label: 'Waiting for traffic',
        description: 'Metrics appear as soon as the first request is traced.',
      },
      busiest: null,
      noisiest: null,
      slowest: null,
      procedureCount: 0,
    }
  }

  const procedures = Object.entries(data.procedures)

  const busiest = procedures.toSorted((a, b) => b[1].count - a[1].count)[0]

  const noisiest = procedures
    .filter(([, procedure]) => procedure.errors > 0)
    .toSorted((a, b) => b[1].errors - a[1].errors)[0]

  const slowest = procedures.toSorted((a, b) => b[1].latency.p95 - a[1].latency.p95)[0]

  return {
    health: getHealthSummary(data, procedures.length),
    busiest: busiest
      ? {
          path: busiest[0],
          value: busiest[1].count,
          meta: `${busiest[1].count} total requests`,
        }
      : null,
    noisiest: noisiest
      ? {
          path: noisiest[0],
          value: noisiest[1].errors,
          meta: `${noisiest[1].errorRate.toFixed(1)}% error rate`,
        }
      : null,
    slowest: slowest
      ? {
          path: slowest[0],
          value: slowest[1].latency.p95,
          meta: `p95 latency hotspot`,
        }
      : null,
    procedureCount: procedures.length,
  }
}

export function getProcedureFocusLists(data: AnalyticsData | null): ProcedureFocusLists {
  if (!data) {
    return {
      traffic: [],
      latency: [],
      failures: [],
    }
  }

  const procedures = Object.entries(data.procedures)

  return {
    traffic: procedures
      .toSorted((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([path, procedure]) => ({
        path,
        value: `${procedure.count} req`,
        meta: `p95 ${procedure.latency.p95.toFixed(1)}ms`,
        tone: 'secondary',
      })),
    latency: procedures
      .toSorted((a, b) => b[1].latency.p95 - a[1].latency.p95)
      .slice(0, 4)
      .map(([path, procedure]) => ({
        path,
        value: `${procedure.latency.p95.toFixed(1)}ms`,
        meta: `${procedure.count} requests`,
        tone: procedure.latency.p95 >= 25 ? 'destructive' : 'secondary',
      })),
    failures: procedures
      .filter(([, procedure]) => procedure.errors > 0)
      .toSorted((a, b) => {
        if (b[1].errors !== a[1].errors) return b[1].errors - a[1].errors
        if (b[1].latency.p95 !== a[1].latency.p95) return b[1].latency.p95 - a[1].latency.p95
        if (b[1].errorRate !== a[1].errorRate) return b[1].errorRate - a[1].errorRate
        return b[1].count - a[1].count
      })
      .slice(0, 4)
      .map(([path, procedure]) => ({
        path,
        value: `${procedure.errors} err`,
        meta: `${procedure.errorRate.toFixed(1)}% rate, p95 ${procedure.latency.p95.toFixed(1)}ms`,
        tone: 'destructive',
      })),
  }
}

function getHealthSummary(data: AnalyticsData, procedureCount: number) {
  if (data.errorRate >= 5 || data.avgLatency >= 250) {
    return {
      tone: 'critical' as const,
      label: 'Needs attention',
      description: `${data.totalErrors} errors across ${procedureCount} procedures.`,
    }
  }

  if (data.errorRate >= 1 || data.avgLatency >= 100) {
    return {
      tone: 'degraded' as const,
      label: 'Watching closely',
      description: `Traffic is flowing, but recent failures are above baseline.`,
    }
  }

  return {
    tone: 'healthy' as const,
    label: 'Stable',
    description: `Latency and error rate are within a healthy range.`,
  }
}
