import { useMemo } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { fmt } from '@/lib/format'

import type { TimeWindow } from '@/lib/types'
import type { ChartConfig } from '@/components/ui/chart'

const chartConfig = {
  count: { label: 'Requests', color: 'var(--chart-1)' },
  errors: { label: 'Errors', color: 'var(--color-destructive)' },
} satisfies ChartConfig

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
}

interface RequestChartProps {
  timeSeries: TimeWindow[]
}

export function RequestChart({ timeSeries }: RequestChartProps) {
  const chartData = useMemo(
    () =>
      timeSeries.map((t) => ({
        time: new Date(t.time * 1000).toLocaleTimeString([], TIME_FORMAT),
        count: t.count,
        errors: t.errors,
      })),
    [timeSeries],
  )

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        Waiting for data...
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <ComposedChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          tickMargin={8}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={28}
          tickFormatter={(value: number) => fmt(value)}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="natural"
          dataKey="count"
          stroke="var(--color-count)"
          fill="url(#fillCount)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 1.5, fill: 'var(--background)' }}
        />
        <Bar
          dataKey="errors"
          fill="var(--color-errors)"
          fillOpacity={0.6}
          radius={[1, 1, 0, 0]}
          barSize={4}
        />
      </ComposedChart>
    </ChartContainer>
  )
}
