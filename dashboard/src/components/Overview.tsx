import { SearchField } from '@/components/dashboard-shell'
import { ProcedureTable } from '@/components/procedure-table'
import { Badge } from '@/components/ui/badge'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fmt, fmtMs, fmtUptime } from '@/lib/format'
import { getOverviewInsights } from '@/lib/insights'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from 'recharts'

import type { ChartConfig } from '@/components/ui/chart'
import type { AnalyticsData } from '@/lib/types'

// ── Constants ──

const TRAFFIC_CONFIG = {
  count: { label: 'Requests', color: 'var(--chart-1)' },
  errors: { label: 'Errors', color: 'var(--color-destructive)' },
} satisfies ChartConfig

const TIME_FMT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' }

// ── Main component ──

interface OverviewProps {
  data: AnalyticsData | null
  navigate: (page: string, id?: string, params?: Record<string, string>) => void
}

export function Overview({ data, navigate }: OverviewProps) {
  const insights = useMemo(() => getOverviewInsights(data), [data])
  const [procedureFilter, setProcedureFilter] = useState('')

  const procs = useMemo(() => (data ? Object.entries(data.procedures) : []), [data])

  const slowest = useMemo(() => [...procs].toSorted((a, b) => b[1].latency.p95 - a[1].latency.p95).slice(0, 5), [procs])
  const noisiest = useMemo(
    () =>
      procs
        .filter(([, p]) => p.errors > 0)
        .toSorted((a, b) => b[1].errors - a[1].errors)
        .slice(0, 5),
    [procs],
  )

  if (!data) {
    return (
      <div className='p-5'>
        <div className='grid grid-cols-2 gap-6 py-4 xl:grid-cols-6'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-12' />
          ))}
        </div>
        <Skeleton className='mt-4 h-24' />
        <div className='mt-4 grid grid-cols-2 gap-4'>
          <Skeleton className='h-28' />
          <Skeleton className='h-28' />
        </div>
      </div>
    )
  }

  const procedureCount = procs.length

  return (
    <div>
      {/* ── Stat strip ── */}
      <div className='grid grid-cols-3 gap-x-0 border-b xl:grid-cols-6'>
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

      {/* ── Hero traffic chart ── */}
      <div className='border-b px-5 py-3'>
        <div className='flex items-center justify-between'>
          <h3 className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Traffic</h3>
          <span className='text-[10px] tabular-nums text-muted-foreground'>{data.timeSeries.length}s window</span>
        </div>
        <TrafficChart timeSeries={data.timeSeries} />
      </div>

      {/* ── Two insight cards ── */}
      <div className='grid border-b xl:grid-cols-2'>
        {/* Slowest procedures */}
        <div className='border-b px-5 py-3 xl:border-r xl:border-b-0'>
          <h3 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
            Slowest (p95)
          </h3>
          {slowest.length === 0 ? (
            <p className='py-2 text-xs text-muted-foreground'>No data yet</p>
          ) : (
            <div className='flex flex-col'>
              {slowest.map(([path, proc]) => {
                const maxP95 = slowest[0]![1].latency.p95
                const pct = (proc.latency.p95 / maxP95) * 100
                return (
                  <div
                    key={path}
                    className='flex cursor-pointer items-center gap-2 border-b border-dashed py-1.5 last:border-0 hover:bg-muted/20'
                    onClick={() => navigate('requests', undefined, { procedure: path })}
                  >
                    <span className='min-w-0 flex-1 truncate font-mono text-[11px] font-semibold'>{path}</span>
                    <div className='hidden w-20 sm:block'>
                      <div className='h-1.5 w-full rounded-full bg-muted'>
                        <div className='h-full rounded-full bg-chart-1/50' style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className='w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground'>
                      {fmtMs(proc.latency.p95)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Error hotspots */}
        <div className='px-5 py-3'>
          <h3 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
            Error hotspots
          </h3>
          {noisiest.length === 0 ? (
            <p className='py-2 text-xs text-muted-foreground'>No errors</p>
          ) : (
            <div className='flex flex-col'>
              {noisiest.map(([path, proc]) => (
                <div
                  key={path}
                  className='flex cursor-pointer items-center gap-2 border-b border-dashed py-1.5 last:border-0 hover:bg-muted/20'
                  onClick={() => navigate('errors', undefined, { procedure: path })}
                >
                  <span className='min-w-0 flex-1 truncate font-mono text-[11px] font-semibold'>{path}</span>
                  <Badge variant='destructive' className='text-[9px]'>
                    {proc.errors}
                  </Badge>
                  <span className='font-mono text-[10px] tabular-nums text-muted-foreground'>
                    {proc.errorRate.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Procedure table ── */}
      <div>
        <div className='flex items-center justify-between gap-3 px-5 pt-4 pb-2'>
          <h3 className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Procedures</h3>
          <div className='flex items-center gap-3'>
            <SearchField
              value={procedureFilter}
              onChange={(e) => setProcedureFilter(e.target.value)}
              placeholder='Filter...'
              className='sm:max-w-48'
            />
            <span className='text-[10px] tabular-nums text-muted-foreground'>{procedureCount} routes</span>
          </div>
        </div>
        <ProcedureTable procedures={data.procedures} navigate={navigate} filter={procedureFilter} />
      </div>
    </div>
  )
}

// ── Traffic chart ──

function TrafficChart({ timeSeries }: { timeSeries: AnalyticsData['timeSeries'] }) {
  const chartData = useMemo(
    () =>
      timeSeries.map((t) => ({
        time: new Date(t.time * 1000).toLocaleTimeString([], TIME_FMT),
        count: t.count,
        errors: t.errors,
      })),
    [timeSeries],
  )

  if (chartData.length === 0) {
    return (
      <div className='flex h-24 items-center justify-center text-xs text-muted-foreground'>Waiting for data...</div>
    )
  }

  return (
    <ChartContainer config={TRAFFIC_CONFIG} className='mt-2 h-24 w-full'>
      <ComposedChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id='fillTraffic' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='var(--color-count)' stopOpacity={0.15} />
            <stop offset='100%' stopColor='var(--color-count)' stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke='var(--color-border)' strokeOpacity={0.3} />
        <XAxis
          dataKey='time'
          tick={{ fontSize: 8 }}
          tickLine={false}
          axisLine={false}
          interval='preserveStartEnd'
          tickMargin={4}
        />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type='monotone'
          dataKey='count'
          stroke='var(--color-count)'
          fill='url(#fillTraffic)'
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 2.5, strokeWidth: 1.5, fill: 'var(--background)' }}
        />
        <Bar dataKey='errors' fill='var(--color-errors)' fillOpacity={0.6} radius={[1, 1, 0, 0]} barSize={3} />
      </ComposedChart>
    </ChartContainer>
  )
}

// ── Shared primitives ──

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
    <div className='border-r px-4 py-3 last:border-r-0'>
      <div className='text-[10px] font-semibold text-muted-foreground'>{label}</div>
      <div className='mt-0.5 flex items-baseline gap-1.5'>
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
