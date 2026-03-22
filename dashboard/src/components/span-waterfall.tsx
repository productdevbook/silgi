import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMs } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'

import type { SpanKind, TraceSpan } from '@/lib/types'

interface SpanWaterfallProps {
  spans: TraceSpan[]
  totalMs: number
}

export function SpanWaterfall({ spans, totalMs }: SpanWaterfallProps) {
  const maxMs = useMemo(() => Math.max(totalMs, ...spans.map((s) => s.durationMs)), [spans, totalMs])
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [allExpanded, setAllExpanded] = useState(false)

  function toggleAll() {
    setAllExpanded(!allExpanded)
    setExpandedIdx(null)
  }

  return (
    <div className='flex flex-col'>
      {/* Header */}
      <div className='grid grid-cols-[2rem_2.5rem_minmax(0,12rem)_1fr_4.5rem_3rem] items-center gap-2 border-b py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground'>
        <button type='button' onClick={toggleAll} className='cursor-pointer text-left hover:text-foreground' title={allExpanded ? 'Collapse all' : 'Expand all'}>
          {allExpanded ? '▼' : '▶'}
        </button>
        <span>kind</span>
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
        const color = SPAN_COLORS[span.kind] ?? SPAN_COLORS.custom
        const barColor = isError ? 'bg-destructive/60' : color.bar
        const isExpanded = allExpanded || expandedIdx === index
        return (
          <div key={`${span.name}-${index}`}>
            <div
              className='grid cursor-pointer grid-cols-[2rem_2.5rem_minmax(0,12rem)_1fr_4.5rem_3rem] items-center gap-2 border-b border-dashed py-2 hover:bg-muted/20 last:border-0'
              onClick={() => setExpandedIdx(isExpanded ? null : index)}
            >
              <span className='font-mono text-[10px] text-muted-foreground/60'>{index + 1}</span>

              <KindBadge kind={span.kind} />

              <div className='flex min-w-0 items-center gap-1.5'>
                <span className={`inline-block size-1.5 shrink-0 rounded-full ${color.dot}`} />
                <span className='truncate font-mono text-[11px]' title={span.name}>
                  {span.name}
                </span>
              </div>

              <Tooltip>
                <TooltipTrigger className='relative h-5 overflow-hidden rounded bg-muted/20'>
                  {/* Offset-based bar (if startOffsetMs available) */}
                  {span.startOffsetMs != null && totalMs > 0 ? (
                    <div
                      className={cn('absolute inset-y-0 rounded', barColor)}
                      style={{
                        left: `${Math.min((span.startOffsetMs / totalMs) * 100, 99)}%`,
                        width: `${Math.max(totalPct, 1.5)}%`,
                      }}
                    />
                  ) : (
                    <div
                      className={cn('absolute inset-y-0 left-0 rounded', barColor)}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  )}
                </TooltipTrigger>
                <TooltipContent side='top' className='text-xs'>
                  <span className='font-medium'>{span.name}</span>
                  <span className='ml-1.5 text-muted-foreground'>[{span.kind}]</span>
                  <span className='ml-2 tabular-nums'>{fmtMs(span.durationMs)}</span>
                  {span.startOffsetMs != null && (
                    <span className='ml-2 text-muted-foreground'>at +{span.startOffsetMs.toFixed(1)}ms</span>
                  )}
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

            {/* Expandable detail — always available */}
            {isExpanded && (
              <div className='border-b bg-muted/10 px-4 py-3'>
                <div className='mb-2 flex flex-wrap items-center gap-2 text-[11px]'>
                  <KindBadge kind={span.kind} />
                  <span className='font-mono font-semibold'>{span.name}</span>
                  <span className='tabular-nums text-muted-foreground'>{fmtMs(span.durationMs)}</span>
                  {span.startOffsetMs != null && (
                    <span className='text-muted-foreground'>at +{span.startOffsetMs.toFixed(1)}ms</span>
                  )}
                  <span className='text-muted-foreground'>({totalMs > 0 ? ((span.durationMs / totalMs) * 100).toFixed(0) : 0}% of total)</span>
                </div>
                {span.attributes && Object.keys(span.attributes).length > 0 && (
                  <div className='mb-2 flex flex-wrap gap-1.5'>
                    {Object.entries(span.attributes).map(([k, v]) => (
                      <span key={k} className='inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[9px]'>
                        <span className='text-muted-foreground'>{k}</span>
                        <span className='text-foreground'>{String(v)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {span.input != null && (
                  <div className='mb-2'>
                    <h5 className='mb-1 text-[10px] font-semibold text-muted-foreground'>Input</h5>
                    <pre className='max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-[10px] leading-relaxed text-muted-foreground'>
                      {typeof span.input === 'string' ? span.input : JSON.stringify(span.input, null, 2)}
                    </pre>
                  </div>
                )}
                {span.output != null && (
                  <div className='mb-2'>
                    <h5 className='mb-1 text-[10px] font-semibold text-muted-foreground'>Output</h5>
                    <pre className='max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-[10px] leading-relaxed text-muted-foreground'>
                      {typeof span.output === 'string' ? span.output : JSON.stringify(span.output, null, 2)}
                    </pre>
                  </div>
                )}
                {span.detail && (
                  <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-[10px] leading-relaxed text-muted-foreground'>
                    {span.detail}
                  </pre>
                )}
                {span.error && (
                  <div className='mt-2 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive'>
                    {span.error}
                  </div>
                )}
                {!span.detail && !span.error && !span.input && !span.output && !span.attributes && (
                  <p className='text-[11px] text-muted-foreground/60'>
                    No detail captured. Use <code className='rounded bg-muted px-1'>{'ctx.trace(name, fn, { detail: "..." })'}</code> to add query/URL info.
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const SPAN_COLORS: Record<SpanKind, { dot: string; bar: string }> = {
  db: { dot: 'bg-purple-500', bar: 'bg-purple-500/50' },
  http: { dot: 'bg-blue-500', bar: 'bg-blue-500/50' },
  cache: { dot: 'bg-emerald-500', bar: 'bg-emerald-500/50' },
  queue: { dot: 'bg-amber-500', bar: 'bg-amber-500/50' },
  email: { dot: 'bg-orange-500', bar: 'bg-orange-500/50' },
  ai: { dot: 'bg-cyan-500', bar: 'bg-cyan-500/50' },
  custom: { dot: 'bg-zinc-400', bar: 'bg-zinc-400/40' },
}

function KindBadge({ kind }: { kind: SpanKind }) {
  const colors: Record<SpanKind, string> = {
    db: 'bg-purple-500/15 text-purple-400',
    http: 'bg-blue-500/15 text-blue-400',
    cache: 'bg-emerald-500/15 text-emerald-400',
    queue: 'bg-amber-500/15 text-amber-400',
    email: 'bg-orange-500/15 text-orange-400',
    ai: 'bg-cyan-500/15 text-cyan-400',
    custom: 'bg-zinc-500/15 text-zinc-400',
  }
  return (
    <span className={cn('rounded px-1 py-0.5 text-center font-mono text-[9px] font-bold uppercase', colors[kind])}>
      {kind}
    </span>
  )
}
