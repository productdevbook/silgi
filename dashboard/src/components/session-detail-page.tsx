import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopy } from '@/hooks'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { sessionToMarkdown, sessionToRedactedJson } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'

import type { RequestEntry, SpanKind } from '@/lib/types'

interface SessionDetailPageProps {
  requests: RequestEntry[]
  sessionId: string
  navigate: (page: string, id?: string) => void
}

const KIND_COLORS: Record<string, { bg: string; dot: string }> = {
  db: { bg: 'bg-purple-500', dot: 'bg-purple-500' },
  redis: { bg: 'bg-red-500', dot: 'bg-red-500' },
  http: { bg: 'bg-blue-500', dot: 'bg-blue-500' },
  cache: { bg: 'bg-emerald-500', dot: 'bg-emerald-500' },
  queue: { bg: 'bg-amber-500', dot: 'bg-amber-500' },
  email: { bg: 'bg-orange-500', dot: 'bg-orange-500' },
  ai: { bg: 'bg-cyan-500', dot: 'bg-cyan-500' },
  custom: { bg: 'bg-zinc-400', dot: 'bg-zinc-400' },
}

export function SessionDetailPage({ requests, sessionId, navigate }: SessionDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const sessionRequests = useMemo(
    () => requests.filter((r) => r.sessionId === sessionId).sort((a, b) => b.timestamp - a.timestamp),
    [requests, sessionId],
  )

  if (sessionRequests.length === 0) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>
        No requests found for session {sessionId}
      </div>
    )
  }

  // Chronological order for flow viz
  const chronological = useMemo(() => [...sessionRequests].reverse(), [sessionRequests])

  const first = chronological[0]!
  const last = chronological[chronological.length - 1]!
  const wallClockMs = last.timestamp + last.durationMs - first.timestamp
  const totalMs = sessionRequests.reduce((sum, r) => sum + r.durationMs, 0)
  const errorCount = sessionRequests.filter((r) => r.status >= 400).length
  const allSpans = sessionRequests.flatMap((r) => r.procedures.flatMap((p) => p.spans))
  const uniqueProcedures = new Set(sessionRequests.flatMap((r) => r.procedures.map((p) => p.procedure)))
  const slowest = sessionRequests.reduce((a, b) => (a.durationMs > b.durationMs ? a : b))
  const fastest = sessionRequests.reduce((a, b) => (a.durationMs < b.durationMs ? a : b))

  // Timing by kind across all requests
  const byKind = new Map<string, number>()
  for (const s of allSpans) {
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
  }
  const tracedMs = [...byKind.values()].reduce((a, b) => a + b, 0)
  const appMs = Math.max(0, totalMs - tracedMs)

  // Method breakdown
  const byMethod = new Map<string, number>()
  for (const r of sessionRequests) {
    byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + 1)
  }

  // Status breakdown
  const byStatus = new Map<string, number>()
  for (const r of sessionRequests) {
    const bucket = r.status < 300 ? '2xx' : r.status < 400 ? '3xx' : r.status < 500 ? '4xx' : '5xx'
    byStatus.set(bucket, (byStatus.get(bucket) ?? 0) + 1)
  }

  // Procedure journey (chronological)
  const journey = chronological.flatMap((r) => r.procedures.map((p) => p.procedure))

  const selectedReq = selectedIdx !== null ? sessionRequests[selectedIdx] : null

  return (
    <div className='flex min-h-full flex-col'>
      {/* Header */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('requests')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Requests
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='text-sm font-semibold'>Session</span>
        <Badge variant='secondary' className='font-mono text-[10px]'>
          {sessionId.slice(0, 13)}
        </Badge>
        <Badge variant='secondary'>{sessionRequests.length} requests</Badge>
        {errorCount > 0 && <Badge variant='destructive'>{errorCount} errors</Badge>}
        <Badge variant='secondary'>{allSpans.length} spans</Badge>
        <div className='ml-auto flex gap-1'>
          <CopyBtn
            copied={copiedId === `md-${sessionId}`}
            onClick={() => copy(`md-${sessionId}`, sessionToMarkdown(sessionRequests, sessionId))}
          >
            md
          </CopyBtn>
          <CopyBtn
            copied={copiedId === `json-${sessionId}`}
            onClick={() => copy(`json-${sessionId}`, sessionToRedactedJson(sessionRequests, sessionId))}
          >
            json
          </CopyBtn>
        </div>
      </div>

      {/* Stat strip */}
      <div className='grid grid-cols-2 gap-x-0 border-b xl:grid-cols-7'>
        <Stat label='Requests' value={String(sessionRequests.length)} />
        <Stat label='Errors' value={String(errorCount)} sub={errorCount > 0 ? `${((errorCount / sessionRequests.length) * 100).toFixed(0)}%` : undefined} danger={errorCount > 0} />
        <Stat label='Wall clock' value={fmtMs(wallClockMs)} />
        <Stat label='Total CPU' value={fmtMs(totalMs)} />
        <Stat label='Avg latency' value={fmtMs(totalMs / sessionRequests.length)} />
        <Stat label='Slowest' value={fmtMs(slowest.durationMs)} sub={slowest.procedures[0]?.procedure} />
        <Stat label='Fastest' value={fmtMs(fastest.durationMs)} sub={fastest.procedures[0]?.procedure} />
      </div>

      {/* Procedure journey */}
      {journey.length > 1 && (
        <div className='flex flex-wrap items-center gap-1 border-b px-5 py-3'>
          <span className='mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Flow</span>
          {journey.map((proc, i) => (
            <span key={i} className='flex items-center gap-1'>
              {i > 0 && <span className='text-[10px] text-muted-foreground/40'>&#8594;</span>}
              <span className='rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]'>{proc}</span>
            </span>
          ))}
        </div>
      )}

      {/* Session flow — Gantt chart */}
      {sessionRequests.length > 1 && (
        <div className='border-b px-5 py-4'>
          <h4 className='mb-3 text-[11px] font-semibold text-muted-foreground'>Session flow</h4>
          <SessionGantt
            requests={chronological}
            sessionStart={first.timestamp}
            wallClockMs={wallClockMs}
            selectedIdx={selectedIdx !== null ? sessionRequests.length - 1 - selectedIdx : null}
            onSelect={(chronIdx) => setSelectedIdx(sessionRequests.length - 1 - chronIdx)}
          />
        </div>
      )}

      <div className='grid flex-1 xl:grid-cols-[1.65fr_0.9fr]'>
        {/* Left: Request timeline + selected detail */}
        <div className='xl:border-r'>
          <Section label={`Request timeline — ${sessionRequests.length} requests`}>
            <div className='flex flex-col'>
              {sessionRequests.map((req, idx) => {
                const spanCount = req.procedures.reduce((s, p) => s + p.spans.length, 0)
                const isSelected = selectedIdx === idx
                const isSlowest = req === slowest && sessionRequests.length > 1

                // Per-request mini timing bar
                const reqByKind = new Map<string, number>()
                for (const p of req.procedures) {
                  for (const s of p.spans) {
                    reqByKind.set(s.kind, (reqByKind.get(s.kind) ?? 0) + s.durationMs)
                  }
                }

                return (
                  <div
                    key={req.id}
                    className={cn(
                      'border-b border-dashed last:border-0',
                      isSelected && 'bg-muted/30',
                    )}
                  >
                    <div
                      className='flex cursor-pointer items-center gap-2 py-2 hover:bg-muted/20'
                      onClick={() => setSelectedIdx(isSelected ? null : idx)}
                    >
                      <span className='w-16 text-[11px] tabular-nums text-muted-foreground'>
                        {fmtRelativeTime(req.timestamp)}
                      </span>
                      <span className='font-mono text-[10px] text-muted-foreground'>{req.method}</span>
                      <span className={cn('flex-1 truncate font-mono text-[11px] font-semibold', isSlowest && 'text-chart-1')}>
                        {req.procedures.map((p) => p.procedure).join(', ')}
                      </span>
                      <Badge variant={req.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
                        {req.status}
                      </Badge>
                      {/* Mini timing bar */}
                      {reqByKind.size > 0 && (
                        <div className='flex h-1.5 w-12 overflow-hidden rounded-full bg-muted'>
                          {[...reqByKind].map(([kind, ms]) => (
                            <div
                              key={kind}
                              className={cn('h-full', KIND_COLORS[kind]?.bg ?? 'bg-zinc-400')}
                              style={{ width: `${(ms / req.durationMs) * 100}%` }}
                            />
                          ))}
                        </div>
                      )}
                      <span className={cn(
                        'w-14 text-right font-mono text-[11px] tabular-nums',
                        isSlowest ? 'font-semibold text-chart-1' : 'text-muted-foreground',
                      )}>
                        {fmtMs(req.durationMs)}
                      </span>
                      <Badge variant='secondary' className='text-[9px]'>
                        {spanCount}
                      </Badge>
                      <Button
                        variant='ghost'
                        size='xs'
                        className='text-[10px] text-muted-foreground'
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate('requests', String(req.id))
                        }}
                      >
                        detail
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* Selected request expanded detail */}
          {selectedReq && (
            <>
              <Section
                label={`Spans — ${selectedReq.procedures.map((p) => p.procedure).join(', ')} (${fmtMs(selectedReq.durationMs)})`}
              >
                {selectedReq.procedures.map((proc, idx) => (
                  <div key={idx} className={cn(selectedReq.procedures.length > 1 && 'mb-4 last:mb-0')}>
                    {selectedReq.procedures.length > 1 && (
                      <div className='mb-2 flex items-center gap-2 text-[11px]'>
                        <span className='font-mono font-semibold'>{proc.procedure}</span>
                        <Badge variant={proc.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
                          {proc.status}
                        </Badge>
                        <span className='text-muted-foreground'>{fmtMs(proc.durationMs)}</span>
                      </div>
                    )}
                    {proc.spans.length > 0 ? (
                      <SpanWaterfall spans={proc.spans} totalMs={proc.durationMs} />
                    ) : (
                      <p className='text-[11px] text-muted-foreground'>No spans recorded.</p>
                    )}
                  </div>
                ))}
              </Section>

              {/* Input/Output preview for selected request */}
              {selectedReq.procedures.map((proc, idx) => {
                const hasInput = proc.input !== undefined && proc.input !== null
                const hasOutput = proc.output !== undefined && proc.output !== null
                if (!hasInput && !hasOutput && !proc.error) return null
                return (
                  <div key={`io-${idx}`}>
                    {hasInput && (
                      <Section label={selectedReq.procedures.length > 1 ? `Input — ${proc.procedure}` : 'Input'}>
                        <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
                          {JSON.stringify(proc.input, null, 2)}
                        </pre>
                      </Section>
                    )}
                    {hasOutput && (
                      <Section label={selectedReq.procedures.length > 1 ? `Output — ${proc.procedure}` : 'Output'}>
                        <pre className='max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
                          {JSON.stringify(proc.output, null, 2)}
                        </pre>
                      </Section>
                    )}
                    {proc.error && (
                      <Section label='Error'>
                        <div className='rounded-md bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive'>
                          {proc.error}
                        </div>
                      </Section>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Right: Session stats */}
        <div>
          <Section label='Session info'>
            <div className='flex flex-col'>
              <KV label='session id' value={sessionId} />
              <KV label='first seen' value={fmtTime(first.timestamp)} />
              <KV label='last seen' value={fmtTime(last.timestamp)} />
              <KV label='wall clock' value={fmtMs(wallClockMs)} />
              <KV label='total cpu time' value={fmtMs(totalMs)} />
              <KV label='requests' value={String(sessionRequests.length)} />
              <KV label='errors' value={String(errorCount)} danger={errorCount > 0} />
              <KV label='avg latency' value={fmtMs(totalMs / sessionRequests.length)} />
              <KV label='procedures' value={String(uniqueProcedures.size)} />
              <KV label='total spans' value={String(allSpans.length)} />
              <KV label='ip' value={last.ip || '-'} />
              <KV label='user agent' value={last.userAgent.slice(0, 60) || '-'} />
            </div>
          </Section>

          {/* Methods + Status combined */}
          <Section label='Breakdown'>
            <div className='space-y-3'>
              <div>
                <div className='mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60'>Methods</div>
                <div className='flex flex-wrap gap-1.5'>
                  {[...byMethod]
                    .sort((a, b) => b[1] - a[1])
                    .map(([method, count]) => (
                      <Badge key={method} variant='outline' className='text-[10px]'>
                        <span className='font-semibold'>{method}</span>
                        <span className='ml-1 text-muted-foreground'>{count}</span>
                      </Badge>
                    ))}
                </div>
              </div>
              <div>
                <div className='mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60'>Status codes</div>
                <div className='flex flex-wrap gap-1.5'>
                  {[...byStatus]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([bucket, count]) => (
                      <Badge
                        key={bucket}
                        variant={bucket === '4xx' || bucket === '5xx' ? 'destructive' : 'secondary'}
                        className='text-[10px]'
                      >
                        {bucket} <span className='ml-1 opacity-70'>{count}</span>
                      </Badge>
                    ))}
                </div>
              </div>
            </div>
          </Section>

          {byKind.size > 0 && (
            <Section label='Time by category'>
              <div className='space-y-2'>
                <div className='flex h-2.5 overflow-hidden rounded-full bg-muted'>
                  {[...byKind].map(([kind, ms]) => (
                    <Tooltip key={kind}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn('h-full', KIND_COLORS[kind]?.bg ?? 'bg-zinc-400')}
                          style={{ width: `${(ms / totalMs) * 100}%` }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side='top' className='text-xs'>
                        {kind}: {ms.toFixed(1)}ms ({((ms / totalMs) * 100).toFixed(0)}%)
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  {appMs > 0.1 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className='h-full bg-zinc-700'
                          style={{ width: `${(appMs / totalMs) * 100}%` }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side='top' className='text-xs'>
                        app: {appMs.toFixed(1)}ms ({((appMs / totalMs) * 100).toFixed(0)}%)
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className='flex flex-wrap gap-x-3 gap-y-1'>
                  {[...byKind].map(([kind, ms]) => (
                    <div key={kind} className='flex items-center gap-1.5 text-[11px]'>
                      <div className={cn('size-2 rounded-full', KIND_COLORS[kind]?.dot ?? 'bg-zinc-400')} />
                      <span className='text-muted-foreground'>{kind}</span>
                      <span className='font-mono tabular-nums'>{ms.toFixed(1)}ms</span>
                      <span className='text-muted-foreground'>({((ms / totalMs) * 100).toFixed(0)}%)</span>
                    </div>
                  ))}
                  {appMs > 0.1 && (
                    <div className='flex items-center gap-1.5 text-[11px]'>
                      <div className='size-2 rounded-full bg-zinc-700' />
                      <span className='text-muted-foreground'>app</span>
                      <span className='font-mono tabular-nums'>{appMs.toFixed(1)}ms</span>
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}

          <Section label='Procedures'>
            <div className='flex flex-col gap-2'>
              {[...uniqueProcedures].sort().map((proc) => {
                const matchingProcs = sessionRequests.flatMap((r) => r.procedures.filter((p) => p.procedure === proc))
                const count = matchingProcs.length
                const totalProcMs = matchingProcs.reduce((sum, p) => sum + p.durationMs, 0)
                const avgProcMs = totalProcMs / count
                const procErrors = matchingProcs.filter((p) => p.status >= 400).length
                const procSpans = matchingProcs.reduce((sum, p) => sum + p.spans.length, 0)

                return (
                  <div key={proc} className='rounded-md border border-dashed p-2.5'>
                    <div className='flex items-center gap-2'>
                      <span className='font-mono text-[11px] font-semibold'>{proc}</span>
                      {procErrors > 0 && (
                        <Badge variant='destructive' className='text-[9px]'>{procErrors} err</Badge>
                      )}
                    </div>
                    <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground'>
                      <span>x{count} calls</span>
                      <span className='font-mono tabular-nums'>{fmtMs(totalProcMs)} total</span>
                      <span className='font-mono tabular-nums'>{fmtMs(avgProcMs)} avg</span>
                      <span>{procSpans} spans</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

// ── Session Gantt chart ──

function SessionGantt({
  requests,
  sessionStart,
  wallClockMs,
  selectedIdx,
  onSelect,
}: {
  requests: RequestEntry[]
  sessionStart: number
  wallClockMs: number
  selectedIdx: number | null
  onSelect: (idx: number) => void
}) {
  const maxMs = Math.max(wallClockMs, 1)

  return (
    <div className='flex flex-col gap-1'>
      {requests.map((req, idx) => {
        const offsetMs = req.timestamp - sessionStart
        const leftPct = (offsetMs / maxMs) * 100
        const widthPct = Math.max((req.durationMs / maxMs) * 100, 1)
        const isError = req.status >= 400
        const isSelected = selectedIdx === idx

        // Color bar by span kinds
        const reqByKind = new Map<string, number>()
        for (const p of req.procedures) {
          for (const s of p.spans) {
            reqByKind.set(s.kind, (reqByKind.get(s.kind) ?? 0) + s.durationMs)
          }
        }

        return (
          <Tooltip key={req.id}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'group relative flex h-6 cursor-pointer items-center rounded-sm',
                  isSelected ? 'bg-muted/50' : 'hover:bg-muted/30',
                )}
                onClick={() => onSelect(idx)}
              >
                {/* Label */}
                <span className='w-24 shrink-0 truncate pr-2 text-right font-mono text-[10px] text-muted-foreground'>
                  {req.procedures.map((p) => p.procedure).join(', ')}
                </span>

                {/* Track */}
                <div className='relative h-4 flex-1 rounded bg-muted/20'>
                  {/* Bar */}
                  <div
                    className={cn(
                      'absolute inset-y-0 flex overflow-hidden rounded',
                      isError ? 'bg-destructive/40' : reqByKind.size === 0 ? 'bg-primary/30' : '',
                      isSelected && 'ring-1 ring-primary/50',
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: '4px' }}
                  >
                    {reqByKind.size > 0 && !isError && (
                      [...reqByKind].map(([kind, ms]) => (
                        <div
                          key={kind}
                          className={cn('h-full opacity-60', KIND_COLORS[kind]?.bg ?? 'bg-zinc-400')}
                          style={{ width: `${(ms / req.durationMs) * 100}%` }}
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Duration label */}
                <span className='w-14 shrink-0 pl-2 text-right font-mono text-[10px] tabular-nums text-muted-foreground'>
                  {fmtMs(req.durationMs)}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side='top' className='text-xs'>
              <div className='font-semibold'>{req.method} {req.procedures.map((p) => p.procedure).join(', ')}</div>
              <div className='text-muted-foreground'>
                {fmtMs(req.durationMs)} &middot; {req.status} &middot; +{fmtMs(req.timestamp - sessionStart)} offset
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}

      {/* Time axis */}
      <div className='flex items-center'>
        <span className='w-24 shrink-0' />
        <div className='relative flex h-4 flex-1 items-center'>
          <span className='absolute left-0 text-[9px] tabular-nums text-muted-foreground/50'>0ms</span>
          <span className='absolute left-1/2 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground/50'>{fmtMs(maxMs / 2)}</span>
          <span className='absolute right-0 text-[9px] tabular-nums text-muted-foreground/50'>{fmtMs(maxMs)}</span>
        </div>
        <span className='w-14 shrink-0' />
      </div>
    </div>
  )
}

// ── Shared components ──

function Stat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className='border-r px-5 py-3 last:border-r-0'>
      <div className='text-[11px] font-semibold text-muted-foreground'>{label}</div>
      <div className='mt-0.5 flex items-baseline gap-1.5'>
        <span className={cn('text-lg font-semibold tabular-nums tracking-tight', danger && 'text-destructive')}>
          {value}
        </span>
        {sub && <span className='max-w-20 truncate text-[10px] text-muted-foreground'>{sub}</span>}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='border-b px-5 py-4 last:border-b-0'>
      <h4 className='mb-3 text-[11px] font-semibold text-muted-foreground'>{label}</h4>
      {children}
    </div>
  )
}

function KV({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='flex items-center justify-between border-b border-dashed py-1.5 last:border-0'>
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <span className={cn('max-w-[60%] truncate font-mono text-[11px]', danger && 'text-destructive')}>{value}</span>
    </div>
  )
}

function CopyBtn({ copied, onClick, children }: { copied: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={copied ? 'default' : 'outline'} size='xs' onClick={onClick}>
      <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} data-icon='inline-start' />
      {copied ? 'copied' : children}
    </Button>
  )
}
