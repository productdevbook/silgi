import { InsightPill, PageHero, PageShell, SectionCard } from '@/components/dashboard-shell'
import { LatencyChart } from '@/components/latency-chart'
import { ProcedureTable } from '@/components/procedure-table'
import { RequestChart } from '@/components/request-chart'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fmt, fmtMs } from '@/lib/format'
import { getOverviewInsights, getProcedureFocusLists } from '@/lib/insights'
import { useMemo } from 'react'

import type { AnalyticsData } from '@/lib/types'

interface OverviewProps {
  data: AnalyticsData | null
}

export function Overview({ data }: OverviewProps) {
  const insights = useMemo(() => getOverviewInsights(data), [data])
  const focusLists = useMemo(() => getProcedureFocusLists(data), [data])
  const trafficSummary = useMemo(() => {
    if (!data) return null
    const peakCount = Math.max(...data.timeSeries.map((point) => point.count))
    const peakErrors = Math.max(...data.timeSeries.map((point) => point.errors))
    const hotWindow = data.timeSeries.reduce(
      (best, point) => (point.count + point.errors > best.count + best.errors ? point : best),
      data.timeSeries[0]!,
    )

    return {
      peakCount,
      peakErrors,
      hotWindow: new Date(hotWindow.time * 1000).toLocaleTimeString(),
    }
  }, [data])

  if (!data) {
    return (
      <PageShell>
        <div className='grid gap-4 xl:grid-cols-[1.5fr_1fr]'>
          <Skeleton className='h-56 rounded-xl' />
          <Skeleton className='h-56 rounded-xl' />
        </div>
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className='flex flex-col gap-2'>
              <Skeleton className='h-3 w-20' />
              <Skeleton className='h-24 rounded-xl' />
            </div>
          ))}
        </div>
        <div className='grid gap-4 xl:grid-cols-[1.6fr_1fr]'>
          <Skeleton className='h-80 rounded-xl' />
          <div className='grid gap-4'>
            <Skeleton className='h-[188px] rounded-xl' />
            <Skeleton className='h-[188px] rounded-xl' />
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className='grid gap-4 xl:grid-cols-[1.6fr_1fr]'>
        <PageHero
          eyebrow='Runtime'
          title='Signal at a glance'
          description='Watch traffic, surface latency hotspots, and catch noisy procedures before they become larger incidents.'
          badges={
            <>
              <Badge variant={getHealthVariant(insights.health.tone)}>{insights.health.label}</Badge>
              <Badge variant='secondary'>{insights.procedureCount} active procedures</Badge>
            </>
          }
        >
          <div className='grid gap-3 md:grid-cols-3'>
            <InsightPill
              label='Busiest procedure'
              value={insights.busiest?.path ?? 'No traffic yet'}
              meta={insights.busiest ? `${fmt(insights.busiest.value)} requests` : 'Requests will surface here'}
            />
            <InsightPill
              label='Noisiest procedure'
              value={insights.noisiest?.path ?? 'No failing procedures'}
              meta={insights.noisiest ? `${insights.noisiest.value} errors` : insights.health.description}
            />
            <InsightPill
              label='Latency hotspot'
              value={insights.slowest?.path ?? 'Awaiting enough samples'}
              meta={insights.slowest ? `${fmtMs(insights.slowest.value)} p95 latency` : 'p95 spikes appear here'}
            />
          </div>
        </PageHero>
        <SectionCard title='Health note' subtitle={insights.health.description}>
          <div className='flex h-full flex-col justify-between gap-5'>
            <div className='flex flex-col gap-2'>
              <p className='text-sm font-medium tracking-tight'>Instance posture</p>
              <p className='text-sm leading-6 text-muted-foreground'>
                The overview combines time-series traffic, percentile latency, and failure volume from the in-memory
                collector.
              </p>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <InsightPill
                label='Error budget'
                value={`${data.errorRate.toFixed(1)}%`}
                meta={`${data.totalErrors} total failures`}
              />
              <InsightPill label='Average latency' value={fmtMs(data.avgLatency)} meta='Across all procedures' />
            </div>
          </div>
        </SectionCard>
      </div>

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <StatCard title='Requests' value={fmt(data.totalRequests)} subtitle='Since collector start' />
        <StatCard title='Throughput' value={`${fmt(data.requestsPerSecond)}/s`} subtitle='Current request rate' />
        <StatCard
          title='Error Rate'
          value={`${data.errorRate.toFixed(1)}%`}
          danger={data.errorRate > 1}
          subtitle={`${data.totalErrors} captured failures`}
        />
        <StatCard title='Latency' value={fmtMs(data.avgLatency)} subtitle='Average end-to-end time' />
      </div>

      <div className='grid gap-4 xl:grid-cols-[1.6fr_1fr]'>
        <SectionCard title='Traffic' subtitle='Request flow with error spikes called out'>
          <div className='flex flex-col gap-4'>
            <div className='grid gap-3 md:grid-cols-3'>
              <InsightPill
                label='Peak throughput'
                value={String(trafficSummary?.peakCount ?? 0)}
                meta='Requests in a single window'
              />
              <InsightPill
                label='Peak errors'
                value={String(trafficSummary?.peakErrors ?? 0)}
                meta='Errors in a single window'
              />
              <InsightPill
                label='Hottest window'
                value={trafficSummary?.hotWindow ?? '—'}
                meta='Highest combined signal'
              />
            </div>
            <RequestChart timeSeries={data.timeSeries} />
          </div>
        </SectionCard>
        <div className='grid gap-4'>
          <SectionCard title='Latency' subtitle='p50 / p95 / p99 on your busiest procedures'>
            <LatencyChart procedures={data.procedures} />
          </SectionCard>
          <SectionCard title='Focus modes' subtitle='Switch between traffic, latency, and failure pressure'>
            <Tabs defaultValue='failures'>
              <TabsList variant='line' className='w-full justify-start'>
                <TabsTrigger value='failures'>Failures</TabsTrigger>
                <TabsTrigger value='latency'>Latency</TabsTrigger>
                <TabsTrigger value='traffic'>Traffic</TabsTrigger>
              </TabsList>
              <TabsContent value='failures' className='mt-4'>
                <FocusList items={focusLists.failures} emptyLabel='No failing procedures' />
              </TabsContent>
              <TabsContent value='latency' className='mt-4'>
                <FocusList items={focusLists.latency} emptyLabel='No latency hotspots' />
              </TabsContent>
              <TabsContent value='traffic' className='mt-4'>
                <FocusList items={focusLists.traffic} emptyLabel='No traffic yet' />
              </TabsContent>
            </Tabs>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title='Procedures'
        subtitle='Sortable breakdown of request volume, failures, error rate, and latency'
        contentClassName='px-0 pb-0'
      >
        <ProcedureTable procedures={data.procedures} />
      </SectionCard>
    </PageShell>
  )
}

function getHealthVariant(tone: 'healthy' | 'degraded' | 'critical') {
  if (tone === 'critical') return 'destructive'
  if (tone === 'degraded') return 'default'
  return 'secondary'
}

function FocusList({
  items,
  emptyLabel,
}: {
  items: ReturnType<typeof getProcedureFocusLists>['traffic']
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <div className='flex min-h-48 items-center justify-center text-sm text-muted-foreground'>{emptyLabel}</div>
  }

  return (
    <div className='flex flex-col gap-3'>
      {items.map((item) => (
        <Card key={item.path} size='sm' className='bg-muted/20 shadow-none'>
          <CardContent>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium tracking-tight'>{item.path}</p>
                <p className='mt-1 text-xs text-muted-foreground'>{item.meta}</p>
              </div>
              <Badge variant={item.tone}>{item.value}</Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
