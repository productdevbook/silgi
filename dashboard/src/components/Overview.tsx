import { SearchField } from '@/components/dashboard-shell'
import { LatencyChart } from '@/components/latency-chart'
import { ProcedureTable } from '@/components/procedure-table'
import { RequestChart } from '@/components/request-chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fmt, fmtMs, fmtUptime } from '@/lib/format'
import { getOverviewInsights } from '@/lib/insights'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'

import type { AnalyticsData } from '@/lib/types'

interface OverviewProps {
  data: AnalyticsData | null
  navigate: (page: string, id?: string, params?: Record<string, string>) => void
}

export function Overview({ data, navigate }: OverviewProps) {
  const insights = useMemo(() => getOverviewInsights(data), [data])
  const [procedureFilter, setProcedureFilter] = useState('')

  if (!data) {
    return (
      <div className='p-5'>
        <div className='grid grid-cols-2 gap-6 py-4 xl:grid-cols-5'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-12' />
          ))}
        </div>
        <Skeleton className='mt-6 h-56' />
        <Skeleton className='mt-6 h-56' />
      </div>
    )
  }

  const procedureCount = Object.keys(data.procedures).length

  return (
    <div>
      {/* Stat strip */}
      <div className='grid grid-cols-2 gap-x-0 border-b xl:grid-cols-6'>
        <Stat label='Requests' value={fmt(data.totalRequests)} />
        <Stat label='Throughput' value={`${fmt(data.requestsPerSecond)}/s`} />
        <Stat
          label='Errors'
          value={String(data.totalErrors)}
          sub={`${data.errorRate.toFixed(1)}%`}
          danger={data.totalErrors > 0}
        />
        <Stat label='Avg latency' value={fmtMs(data.avgLatency)} />
        <Stat label='Uptime' value={fmtUptime(data.uptime)} />
        <Stat
          label='Health'
          value={insights.health.label}
          className={cn(
            insights.health.tone === 'healthy' && 'text-emerald-600 dark:text-emerald-400',
            insights.health.tone === 'degraded' && 'text-amber-600 dark:text-amber-400',
            insights.health.tone === 'critical' && 'text-destructive',
          )}
        />
      </div>

      {/* Charts */}
      <div className='grid xl:grid-cols-[1.6fr_1fr]'>
        <div className='border-b p-5 xl:border-r'>
          <SectionLabel>Traffic</SectionLabel>
          <div className='mt-3'>
            <RequestChart timeSeries={data.timeSeries} />
          </div>
        </div>
        <div className='border-b p-5'>
          <SectionLabel>Latency distribution</SectionLabel>
          <div className='mt-3'>
            <LatencyChart procedures={data.procedures} />
          </div>
        </div>
      </div>

      {/* Procedure table */}
      <div>
        <div className='flex items-center justify-between gap-3 px-5 pt-4 pb-2'>
          <SectionLabel>Procedures</SectionLabel>
          <div className='flex items-center gap-3'>
            <SearchField
              value={procedureFilter}
              onChange={(e) => setProcedureFilter(e.target.value)}
              placeholder='Filter procedures...'
              className='sm:max-w-48'
            />
            <span className='text-xs tabular-nums text-muted-foreground'>{procedureCount} routes</span>
          </div>
        </div>
        <ProcedureTable procedures={data.procedures} navigate={navigate} filter={procedureFilter} />
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  danger,
  className,
}: {
  label: string
  value: string
  sub?: string
  danger?: boolean
  className?: string
}) {
  return (
    <div className='border-r px-5 py-4 last:border-r-0'>
      <div className='text-[11px] font-semibold text-muted-foreground'>{label}</div>
      <div className='mt-1 flex items-baseline gap-1.5'>
        <span
          className={cn('text-lg font-semibold tabular-nums tracking-tight', danger && 'text-destructive', className)}
        >
          {value}
        </span>
        {sub && <span className='text-[11px] text-muted-foreground'>{sub}</span>}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className='text-xs font-semibold text-muted-foreground'>{children}</h3>
}
