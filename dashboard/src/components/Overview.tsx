import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowTurnUpIcon, ArrowTurnDownIcon, TimerIcon, Alert02Icon } from '@hugeicons/core-free-icons'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

import { fmt, fmtMs } from '../hooks'

import type { AnalyticsData, ProcedureSnapshot } from '../hooks'
import type { ChartConfig } from '@/components/ui/chart'

type SortCol = 'path' | 'count' | 'errors' | 'avg' | 'p50' | 'p95' | 'p99'

const chartConfig = {
  count: { label: 'Requests', color: 'var(--color-gold)' },
  errors: { label: 'Errors', color: 'var(--color-destructive)' },
} satisfies ChartConfig

export default function Overview({ data }: { data: AnalyticsData | null }) {
  if (!data) {
    return <div className='flex h-[60vh] items-center justify-center text-sm text-muted-foreground'>Connecting...</div>
  }

  return (
    <div className='p-6 space-y-6'>
      {/* Cards */}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard
          title='Total Requests'
          value={fmt(data.totalRequests)}
          icon={ArrowTurnUpIcon}
        />
        <StatCard
          title='Requests / sec'
          value={fmt(data.requestsPerSecond)}
          icon={ArrowTurnDownIcon}
        />
        <StatCard
          title='Error Rate'
          value={`${data.errorRate.toFixed(1)}%`}
          icon={Alert02Icon}
          danger={data.errorRate > 1}
          subtitle={`${data.totalErrors} total errors`}
        />
        <StatCard
          title='Avg Latency'
          value={fmtMs(data.avgLatency)}
          icon={TimerIcon}
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className='text-sm'>Request Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <RequestChart timeSeries={data.timeSeries} />
        </CardContent>
      </Card>

      <Separator />

      {/* Procedure Table */}
      <div>
        <h2 className='mb-3 text-sm font-semibold'>Procedures</h2>
        <ProcedureTable procedures={data.procedures} />
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  danger,
  subtitle,
}: {
  title: string
  value: string
  icon: any
  danger?: boolean
  subtitle?: string
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-xs font-medium text-muted-foreground'>{title}</CardTitle>
          <HugeiconsIcon icon={icon} size={16} className='text-muted-foreground' />
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${danger ? 'text-destructive' : ''}`}>{value}</div>
        {subtitle && <p className='mt-0.5 text-xs text-muted-foreground'>{subtitle}</p>}
      </CardContent>
    </Card>
  )
}

function RequestChart({ timeSeries }: { timeSeries: AnalyticsData['timeSeries'] }) {
  const chartData = useMemo(
    () =>
      timeSeries.map((t) => ({
        time: new Date(t.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        count: t.count,
        errors: t.errors,
      })),
    [timeSeries],
  )

  if (!chartData.length) {
    return <div className='flex h-40 items-center justify-center text-sm text-muted-foreground'>No data yet</div>
  }

  return (
    <ChartContainer config={chartConfig} className='h-40 w-full aspect-auto'>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray='3 3' className='stroke-border' />
        <XAxis
          dataKey='time'
          tick={{ fontSize: 10 }}
          interval='preserveStartEnd'
          className='text-muted-foreground'
        />
        <YAxis tick={{ fontSize: 10 }} width={40} className='text-muted-foreground' />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type='monotone'
          dataKey='count'
          stroke='var(--color-count)'
          fill='var(--color-count)'
          fillOpacity={0.1}
          strokeWidth={1.5}
        />
        <Area
          type='monotone'
          dataKey='errors'
          stroke='var(--color-errors)'
          fill='var(--color-errors)'
          fillOpacity={0.15}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ChartContainer>
  )
}

function ProcedureTable({ procedures }: { procedures: Record<string, ProcedureSnapshot> }) {
  const [sortCol, setSortCol] = useState<SortCol>('count')
  const [sortDir, setSortDir] = useState(-1)

  const entries = useMemo(() => {
    const arr = Object.entries(procedures)
    arr.sort((a, b) => {
      if (sortCol === 'path') return sortDir * a[0].localeCompare(b[0])
      const va = sortCol === 'count' || sortCol === 'errors' ? a[1][sortCol] : a[1].latency[sortCol]
      const vb = sortCol === 'count' || sortCol === 'errors' ? b[1][sortCol] : b[1].latency[sortCol]
      return sortDir * (va - vb)
    })
    return arr
  }, [procedures, sortCol, sortDir])

  const maxCount = Math.max(1, ...entries.map(([, p]) => p.count))

  if (!entries.length) {
    return <div className='py-10 text-center text-sm text-muted-foreground'>No requests yet</div>
  }

  const cols: { key: SortCol; label: string }[] = [
    { key: 'path', label: 'Procedure' },
    { key: 'count', label: 'Count' },
    { key: 'errors', label: 'Errors' },
    { key: 'avg', label: 'Avg' },
    { key: 'p50', label: 'p50' },
    { key: 'p95', label: 'p95' },
    { key: 'p99', label: 'p99' },
  ]

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => d * -1)
    else {
      setSortCol(col)
      setSortDir(-1)
    }
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead
                key={c.key}
                onClick={() => handleSort(c.key)}
                className={`cursor-pointer select-none ${
                  sortCol === c.key ? 'text-primary' : ''
                } ${c.key !== 'path' ? 'text-right' : ''}`}
              >
                {c.label}
                {sortCol === c.key && (sortDir > 0 ? ' \u2191' : ' \u2193')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([path, p]) => (
            <TableRow key={path}>
              <TableCell className='font-medium text-primary'>{path.replace(/\//g, ' / ')}</TableCell>
              <TableCell className='text-right'>
                <div className='flex items-center justify-end gap-2'>
                  <Progress value={(p.count / maxCount) * 100} className='w-16 h-1.5'>
                    <ProgressTrack>
                      <ProgressIndicator className='bg-primary' />
                    </ProgressTrack>
                  </Progress>
                  {fmt(p.count)}
                </div>
              </TableCell>
              <TableCell className='text-right'>
                {p.errors > 0 ? (
                  <Badge variant='destructive' className='text-[10px]'>{p.errors}</Badge>
                ) : (
                  <span className='text-muted-foreground'>0</span>
                )}
              </TableCell>
              <TableCell className='text-right tabular-nums'>{fmtMs(p.latency.avg)}</TableCell>
              <TableCell className='text-right tabular-nums'>{fmtMs(p.latency.p50)}</TableCell>
              <TableCell className='text-right tabular-nums'>{fmtMs(p.latency.p95)}</TableCell>
              <TableCell className='text-right tabular-nums'>{fmtMs(p.latency.p99)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
