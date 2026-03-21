import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { fmtMs } from '@/lib/format'
import { useMemo } from 'react'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'

import type { ChartConfig } from '@/components/ui/chart'
import type { ProcedureSnapshot } from '@/lib/types'

const chartConfig = {
  p50: { label: 'p50', color: 'var(--chart-3)' },
  p95: { label: 'p95', color: 'var(--chart-1)' },
  p99: { label: 'p99', color: 'var(--color-muted-foreground)' },
} satisfies ChartConfig

interface LatencyChartProps {
  procedures: Record<string, ProcedureSnapshot>
}

export function LatencyChart({ procedures }: LatencyChartProps) {
  const data = useMemo(() => {
    return Object.entries(procedures)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([path, proc]) => ({
        name: path.split('/').pop() || path,
        fullPath: path,
        p50: proc.latency.p50,
        p95: proc.latency.p95,
        p99: proc.latency.p99,
      }))
  }, [procedures])

  if (data.length === 0) return null

  return (
    <ChartContainer config={chartConfig} className='h-48 w-full'>
      <BarChart data={data} layout='vertical' margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <YAxis dataKey='name' type='category' tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={72} />
        <XAxis
          type='number'
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => fmtMs(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_value, payload) => {
                const item = payload?.[0]?.payload
                return item?.fullPath ?? _value
              }}
              formatter={(value, name) => [fmtMs(value as number), name]}
            />
          }
        />
        <Bar dataKey='p50' fill='var(--color-p50)' radius={[0, 2, 2, 0]} barSize={5} />
        <Bar dataKey='p95' fill='var(--color-p95)' radius={[0, 2, 2, 0]} barSize={5} />
        <Bar dataKey='p99' fill='var(--color-p99)' fillOpacity={0.4} radius={[0, 2, 2, 0]} barSize={5} />
      </BarChart>
    </ChartContainer>
  )
}
