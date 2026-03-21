import { Skeleton } from '@/components/ui/skeleton'
import { ErrorChart } from '@/components/error-chart'
import { LatencyChart } from '@/components/latency-chart'
import { ProcedureTable } from '@/components/procedure-table'
import { RequestChart } from '@/components/request-chart'
import { StatCard } from '@/components/stat-card'
import { fmt, fmtMs } from '@/lib/format'

import type { AnalyticsData } from '@/lib/types'

interface OverviewProps {
  data: AnalyticsData | null
}

export function Overview({ data }: OverviewProps) {
  if (!data) {
    return (
      <div className="space-y-8 p-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-10 p-8">
      {/* Metrics */}
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Requests" value={fmt(data.totalRequests)} />
        <StatCard title="Throughput" value={`${fmt(data.requestsPerSecond)}/s`} />
        <StatCard
          title="Error Rate"
          value={`${data.errorRate.toFixed(1)}%`}
          danger={data.errorRate > 1}
          subtitle={`${data.totalErrors} total`}
        />
        <StatCard title="Latency" value={fmtMs(data.avgLatency)} subtitle="avg" />
      </div>

      {/* Traffic */}
      <Section title="Traffic">
        <RequestChart timeSeries={data.timeSeries} />
      </Section>

      {/* Two-col: Latency + Errors */}
      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Latency" subtitle="p50 / p95 / p99">
          <LatencyChart procedures={data.procedures} />
        </Section>
        <Section title="Errors" subtitle="by procedure">
          <ErrorChart procedures={data.procedures} />
        </Section>
      </div>

      {/* Procedures */}
      <Section title="Procedures">
        <ProcedureTable procedures={data.procedures} />
      </Section>
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-xs font-medium tracking-wide text-foreground uppercase">{title}</h2>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}
