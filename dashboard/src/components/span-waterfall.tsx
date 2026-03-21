import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMs } from '@/lib/format'

import type { TraceSpan } from '@/lib/types'

interface SpanWaterfallProps {
  spans: TraceSpan[]
  totalMs: number
}

export function SpanWaterfall({ spans, totalMs }: SpanWaterfallProps) {
  const maxMs = useMemo(
    () => Math.max(totalMs, ...spans.map((s) => s.durationMs)),
    [spans, totalMs],
  )

  return (
    <div className="space-y-1">
      {spans.map((span, i) => {
        const pct = maxMs > 0 ? (span.durationMs / maxMs) * 100 : 0
        const isError = !!span.error
        const isSlow = span.durationMs > totalMs * 0.5

        return (
          <div key={i} className="group flex items-center gap-3">
            {/* Name */}
            <div className="flex w-32 shrink-0 items-center gap-1.5 lg:w-44">
              <SpanIcon type={guessSpanType(span.name)} />
              <span className="truncate font-mono text-[11px]" title={span.name}>
                {span.name}
              </span>
            </div>

            {/* Bar */}
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/50">
              <Tooltip>
                <TooltipTrigger
                  className="absolute inset-y-0 left-0 flex items-center rounded transition-all"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                >
                  <div
                    className={`h-full w-full rounded ${
                      isError
                        ? 'bg-destructive/60'
                        : isSlow
                          ? 'bg-amber-500/50 dark:bg-amber-400/40'
                          : 'bg-primary/30'
                    }`}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <span className="font-medium">{span.name}</span>
                  <span className="ml-2 tabular-nums">{fmtMs(span.durationMs)}</span>
                  {span.error && (
                    <span className="ml-2 text-destructive">{span.error}</span>
                  )}
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Duration + status */}
            <div className="flex w-20 shrink-0 items-center justify-end gap-2">
              <span className={`font-mono text-[11px] tabular-nums ${isError ? 'text-destructive' : isSlow ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {fmtMs(span.durationMs)}
              </span>
              {isError && (
                <Badge variant="destructive" className="h-4 px-1 text-[9px]">err</Badge>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Span type detection ──────────────────────────────

type SpanType = 'db' | 'http' | 'cache' | 'queue' | 'default'

function guessSpanType(name: string): SpanType {
  const n = name.toLowerCase()
  if (n.includes('db') || n.includes('sql') || n.includes('query') || n.includes('prisma') || n.includes('drizzle') || n.includes('mongo')) return 'db'
  if (n.includes('http') || n.includes('fetch') || n.includes('api') || n.includes('request')) return 'http'
  if (n.includes('cache') || n.includes('redis') || n.includes('memcache')) return 'cache'
  if (n.includes('queue') || n.includes('publish') || n.includes('nats') || n.includes('kafka')) return 'queue'
  return 'default'
}

const SPAN_COLORS: Record<SpanType, string> = {
  db: 'bg-blue-500',
  http: 'bg-emerald-500',
  cache: 'bg-amber-500',
  queue: 'bg-purple-500',
  default: 'bg-muted-foreground',
}

function SpanIcon({ type }: { type: SpanType }) {
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${SPAN_COLORS[type]}`} />
}
