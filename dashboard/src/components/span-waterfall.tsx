import { useMemo } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMs } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { TraceSpan } from '@/lib/types'

interface SpanWaterfallProps {
  spans: TraceSpan[]
  totalMs: number
}

export function SpanWaterfall({ spans, totalMs }: SpanWaterfallProps) {
  const maxMs = useMemo(() => Math.max(totalMs, ...spans.map((span) => span.durationMs)), [spans, totalMs])

  return (
    <div className='flex flex-col'>
      {/* Header */}
      <div className='grid grid-cols-[2rem_minmax(0,12rem)_1fr_4.5rem_3rem] items-center gap-2 border-b py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground'>
        <span>#</span>
        <span>span</span>
        <span>timeline</span>
        <span className='text-right'>dur</span>
        <span className='text-right'>%</span>
      </div>

      {spans.map((span, index) => {
        const pct = maxMs > 0 ? (span.durationMs / maxMs) * 100 : 0
        const totalPct = totalMs > 0 ? (span.durationMs / totalMs) * 100 : 0
        const isError = !!span.error
        const isSlow = span.durationMs > totalMs * 0.5

        return (
          <div
            key={`${span.name}-${index}`}
            className='grid grid-cols-[2rem_minmax(0,12rem)_1fr_4.5rem_3rem] items-center gap-2 border-b border-dashed py-2 last:border-0'
          >
            <span className='font-mono text-[10px] text-muted-foreground/60'>{index + 1}</span>

            <div className='flex min-w-0 items-center gap-1.5'>
              <SpanDot type={guessSpanType(span.name)} />
              <span className='truncate font-mono text-[11px]' title={span.name}>
                {span.name}
              </span>
            </div>

            <Tooltip>
              <TooltipTrigger className='relative h-4 overflow-hidden rounded-sm bg-muted/30'>
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-sm',
                    isError ? 'bg-destructive/60' : isSlow ? 'bg-chart-1/50' : 'bg-primary/30',
                  )}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </TooltipTrigger>
              <TooltipContent side='top' className='text-xs'>
                <span className='font-medium'>{span.name}</span>
                <span className='ml-2 tabular-nums'>{fmtMs(span.durationMs)}</span>
                {span.error && <span className='ml-2 text-destructive'>{span.error}</span>}
              </TooltipContent>
            </Tooltip>

            <span
              className={cn(
                'text-right font-mono text-[11px] tabular-nums',
                isError ? 'text-destructive' : isSlow ? 'text-chart-1' : 'text-muted-foreground',
              )}
            >
              {fmtMs(span.durationMs)}
            </span>

            <span className='text-right font-mono text-[10px] text-muted-foreground/60'>{totalPct.toFixed(0)}%</span>
          </div>
        )
      })}
    </div>
  )
}

type SpanType = 'db' | 'http' | 'cache' | 'queue' | 'default'

function guessSpanType(name: string): SpanType {
  const lower = name.toLowerCase()
  if (
    lower.includes('db')
    || lower.includes('sql')
    || lower.includes('query')
    || lower.includes('prisma')
    || lower.includes('drizzle')
    || lower.includes('mongo')
  )
    return 'db'
  if (lower.includes('http') || lower.includes('fetch') || lower.includes('api') || lower.includes('request'))
    return 'http'
  if (lower.includes('cache') || lower.includes('redis') || lower.includes('memcache'))
    return 'cache'
  if (lower.includes('queue') || lower.includes('publish') || lower.includes('nats') || lower.includes('kafka'))
    return 'queue'
  return 'default'
}

const SPAN_COLORS: Record<SpanType, string> = {
  db: 'bg-chart-4',
  http: 'bg-chart-3',
  cache: 'bg-chart-1',
  queue: 'bg-chart-5',
  default: 'bg-muted-foreground',
}

function SpanDot({ type }: { type: SpanType }) {
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${SPAN_COLORS[type]}`} />
}
