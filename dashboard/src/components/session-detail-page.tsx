import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopy } from '@/hooks'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { sessionToMarkdown, sessionToRedactedJson } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon, Cancel01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart } from 'recharts'

import type { ChartConfig } from '@/components/ui/chart'
import type { RequestEntry } from '@/lib/types'

// ── Constants ──

const KIND_HEX: Record<string, string> = {
  db: '#a855f7', redis: '#ef4444', http: '#3b82f6', cache: '#10b981',
  queue: '#f59e0b', email: '#f97316', ai: '#06b6d4', custom: '#a1a1aa',
}

const OVERVIEW_CHART_CONFIG = {
  duration: { label: 'Duration', color: 'var(--chart-1)' },
} satisfies ChartConfig

// ── Main component ──

interface SessionDetailPageProps {
  requests: RequestEntry[]
  sessionId: string
  navigate: (page: string, id?: string) => void
}

export function SessionDetailPage({ requests, sessionId, navigate }: SessionDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const sessionRequests = useMemo(
    () => requests.filter((r) => r.sessionId === sessionId).sort((a, b) => b.timestamp - a.timestamp),
    [requests, sessionId],
  )
  const chronological = useMemo(() => [...sessionRequests].reverse(), [sessionRequests])

  if (sessionRequests.length === 0) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>
        No requests found for session {sessionId}
      </div>
    )
  }

  const first = chronological[0]!
  const last = chronological[chronological.length - 1]!
  const wallClockMs = last.timestamp + last.durationMs - first.timestamp
  const totalMs = sessionRequests.reduce((sum, r) => sum + r.durationMs, 0)
  const errorCount = sessionRequests.filter((r) => r.status >= 400).length
  const allSpans = sessionRequests.flatMap((r) => r.procedures.flatMap((p) => p.spans))
  const uniqueProcedures = [...new Set(sessionRequests.flatMap((r) => r.procedures.map((p) => p.procedure)))].sort()
  const maxDuration = Math.max(...sessionRequests.map((r) => r.durationMs), 0.1)

  const byKind = new Map<string, number>()
  for (const s of allSpans) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
  const appMs = Math.max(0, totalMs - [...byKind.values()].reduce((a, b) => a + b, 0))

  const byStatus = new Map<string, number>()
  for (const r of sessionRequests) {
    const bucket = r.status < 300 ? '2xx' : r.status < 400 ? '3xx' : r.status < 500 ? '4xx' : '5xx'
    byStatus.set(bucket, (byStatus.get(bucket) ?? 0) + 1)
  }

  const selectedReq = selectedIdx !== null ? sessionRequests[selectedIdx] : null

  return (
    <div className='flex min-h-full flex-col'>
      {/* ── Header ── */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('sessions')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Sessions
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='text-sm font-semibold'>Session</span>
        <Badge variant='secondary' className='font-mono text-[10px]'>{sessionId.slice(0, 13)}</Badge>
        <div className='ml-auto flex gap-1'>
          <CopyBtn copied={copiedId === `md-${sessionId}`} onClick={() => copy(`md-${sessionId}`, sessionToMarkdown(sessionRequests, sessionId))}>md</CopyBtn>
          <CopyBtn copied={copiedId === `json-${sessionId}`} onClick={() => copy(`json-${sessionId}`, sessionToRedactedJson(sessionRequests, sessionId))}>json</CopyBtn>
        </div>
      </div>

      {/* ── Stat strip ── */}
      <div className='grid grid-cols-3 gap-x-0 border-b xl:grid-cols-6'>
        <Stat label='Requests' value={String(sessionRequests.length)} />
        <Stat label='Errors' value={String(errorCount)} danger={errorCount > 0} />
        <Stat label='Avg latency' value={fmtMs(totalMs / sessionRequests.length)} />
        <Stat label='Total CPU' value={fmtMs(totalMs)} />
        <Stat label='Duration' value={fmtMs(wallClockMs)} />
        <Stat label='Spans' value={String(allSpans.length)} />
      </div>

      {/* ── Overview bar chart ── */}
      <OverviewBarChart
        requests={chronological}
        totalRequests={sessionRequests.length}
        selectedIdx={selectedIdx}
        onSelect={(chronIdx) => setSelectedIdx(chronIdx !== null ? sessionRequests.length - 1 - chronIdx : null)}
      />

      {/* ── Body: request list + right panel ── */}
      <div className='flex flex-1 overflow-hidden'>
        {/* Request list */}
        <div className={cn('flex-1 overflow-y-auto', selectedReq && 'hidden xl:block')}>
          {sessionRequests.map((req, idx) => (
            <RequestRow
              key={req.id}
              req={req}
              isSelected={selectedIdx === idx}
              maxDuration={maxDuration}
              onClick={() => setSelectedIdx(selectedIdx === idx ? null : idx)}
            />
          ))}
        </div>

        {/* Right panel: session info (idle) or request detail (selected) */}
        <div className={cn('flex w-full flex-col border-l xl:w-[420px] xl:shrink-0', !selectedReq && 'hidden xl:flex')}>
          {selectedReq ? (
            <RequestDetailPanel req={selectedReq} onClose={() => setSelectedIdx(null)} onOpenFull={() => navigate('requests', String(selectedReq.id))} />
          ) : (
            <SessionInfoPanel
              sessionId={sessionId}
              first={first}
              last={last}
              wallClockMs={wallClockMs}
              totalMs={totalMs}
              sessionRequests={sessionRequests}
              errorCount={errorCount}
              byStatus={byStatus}
              byKind={byKind}
              appMs={appMs}
              uniqueProcedures={uniqueProcedures}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Request row ──

function RequestRow({ req, isSelected, maxDuration, onClick }: {
  req: RequestEntry
  isSelected: boolean
  maxDuration: number
  onClick: () => void
}) {
  const spanCount = req.procedures.reduce((s, p) => s + p.spans.length, 0)
  const isError = req.status >= 400
  const durationPct = (req.durationMs / maxDuration) * 100

  return (
    <div
      className={cn('flex cursor-pointer items-center gap-2 border-b border-dashed px-5 py-2 hover:bg-muted/20', isSelected && 'bg-primary/5')}
      onClick={onClick}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground'>{fmtRelativeTime(req.timestamp)}</span>
        </TooltipTrigger>
        <TooltipContent side='right' className='text-xs'>{fmtTime(req.timestamp)}</TooltipContent>
      </Tooltip>
      <span className={cn('size-1.5 shrink-0 rounded-full', isError ? 'bg-destructive' : 'bg-emerald-500')} />
      <span className='w-8 shrink-0 font-mono text-[10px] text-muted-foreground'>{req.method}</span>
      <span className='min-w-0 flex-1 truncate font-mono text-[11px] font-semibold'>
        {req.procedures.map((p) => p.procedure).join(', ')}
      </span>
      <Badge variant={isError ? 'destructive' : 'secondary'} className='text-[9px]'>{req.status}</Badge>
      <div className='hidden w-28 lg:block'>
        <div className='h-1.5 w-full rounded-full bg-muted'>
          <div
            className={cn('h-full rounded-full', isError ? 'bg-destructive/50' : 'bg-primary/40')}
            style={{ width: `${Math.max(durationPct, 2)}%` }}
          />
        </div>
      </div>
      <span className='w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground'>{fmtMs(req.durationMs)}</span>
      <span className='w-4 shrink-0 text-right font-mono text-[9px] text-muted-foreground/50'>{spanCount || ''}</span>
    </div>
  )
}

// ── Request detail panel (right side) ──

function RequestDetailPanel({ req, onClose, onOpenFull }: { req: RequestEntry; onClose: () => void; onOpenFull: () => void }) {
  return (
    <>
      <div className='flex items-center gap-2 border-b px-4 py-2'>
        <span className='flex-1 truncate font-mono text-[11px] font-semibold'>
          {req.procedures.map((p) => p.procedure).join(', ')}
        </span>
        <Badge variant={req.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>{req.status}</Badge>
        <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>{fmtMs(req.durationMs)}</span>
        <Button variant='ghost' size='icon-sm' onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      <div className='flex-1 overflow-y-auto'>
        {req.procedures.map((proc, idx) => (
          <div key={idx}>
            {req.procedures.length > 1 && (
              <div className='flex items-center gap-2 border-b bg-muted/20 px-4 py-1.5 text-[11px]'>
                <span className='font-mono font-semibold'>{proc.procedure}</span>
                <Badge variant={proc.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>{proc.status}</Badge>
                <span className='text-muted-foreground'>{fmtMs(proc.durationMs)}</span>
              </div>
            )}
            {proc.spans.length > 0 && (
              <PanelSection label='Spans'>
                <SpanWaterfall spans={proc.spans} totalMs={proc.durationMs} />
              </PanelSection>
            )}
            {proc.input !== undefined && proc.input !== null && (
              <PanelSection label={req.procedures.length > 1 ? `Input — ${proc.procedure}` : 'Input'}>
                <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
                  {JSON.stringify(proc.input, null, 2)}
                </pre>
              </PanelSection>
            )}
            {proc.output !== undefined && proc.output !== null && (
              <PanelSection label={req.procedures.length > 1 ? `Output — ${proc.procedure}` : 'Output'}>
                <pre className='max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
                  {JSON.stringify(proc.output, null, 2)}
                </pre>
              </PanelSection>
            )}
            {proc.error && (
              <PanelSection label='Error'>
                <div className='rounded-md bg-destructive/10 px-2.5 py-2 font-mono text-[10px] text-destructive'>{proc.error}</div>
              </PanelSection>
            )}
          </div>
        ))}
        <PanelSection label='Request'>
          <PanelKV label='method' value={req.method} />
          <PanelKV label='path' value={req.path} />
          <PanelKV label='status' value={String(req.status)} danger={req.status >= 400} />
          <PanelKV label='duration' value={fmtMs(req.durationMs)} />
          <PanelKV label='time' value={fmtTime(req.timestamp)} />
          <PanelKV label='ip' value={req.ip || '-'} />
        </PanelSection>
        <div className='px-4 py-3'>
          <Button variant='outline' size='xs' className='w-full' onClick={onOpenFull}>Open full detail</Button>
        </div>
      </div>
    </>
  )
}

// ── Session info panel (right side, when idle) ──

function SessionInfoPanel({ sessionId, first, last, wallClockMs, totalMs, sessionRequests, errorCount, byStatus, byKind, appMs, uniqueProcedures }: {
  sessionId: string
  first: RequestEntry
  last: RequestEntry
  wallClockMs: number
  totalMs: number
  sessionRequests: RequestEntry[]
  errorCount: number
  byStatus: Map<string, number>
  byKind: Map<string, number>
  appMs: number
  uniqueProcedures: string[]
}) {
  return (
    <div className='flex-1 overflow-y-auto'>
      <PanelSection label='Session'>
        <PanelKV label='session id' value={sessionId} />
        <PanelKV label='first seen' value={fmtTime(first.timestamp)} />
        <PanelKV label='last seen' value={fmtTime(last.timestamp)} />
        <PanelKV label='wall clock' value={fmtMs(wallClockMs)} />
        <PanelKV label='total cpu' value={fmtMs(totalMs)} />
        <PanelKV label='requests' value={String(sessionRequests.length)} />
        <PanelKV label='errors' value={String(errorCount)} danger={errorCount > 0} />
        <PanelKV label='avg latency' value={fmtMs(totalMs / sessionRequests.length)} />
        <PanelKV label='ip' value={last.ip || '-'} />
        <PanelKV label='user agent' value={last.userAgent?.slice(0, 80) || '-'} />
      </PanelSection>

      <PanelSection label='Status'>
        <div className='flex flex-wrap gap-1.5'>
          {[...byStatus].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, count]) => (
            <Badge key={bucket} variant={bucket === '4xx' || bucket === '5xx' ? 'destructive' : 'secondary'} className='text-[10px]'>
              {bucket} <span className='ml-1 opacity-70'>{count}</span>
            </Badge>
          ))}
        </div>
      </PanelSection>

      {byKind.size > 0 && (
        <PanelSection label='Time by category'>
          <TimingDonut byKind={byKind} appMs={appMs} totalMs={totalMs} />
        </PanelSection>
      )}

      <PanelSection label='Procedures'>
        {uniqueProcedures.map((proc) => {
          const matching = sessionRequests.flatMap((r) => r.procedures.filter((p) => p.procedure === proc))
          const count = matching.length
          const avg = matching.reduce((sum, p) => sum + p.durationMs, 0) / count
          const errors = matching.filter((p) => p.status >= 400).length
          return (
            <div key={proc} className='flex items-center justify-between gap-2 border-b border-dashed py-1.5 last:border-0'>
              <div className='flex min-w-0 items-center gap-1.5'>
                <span className='truncate font-mono text-[10px] font-semibold'>{proc}</span>
                {errors > 0 && <Badge variant='destructive' className='text-[9px]'>{errors}</Badge>}
              </div>
              <div className='flex shrink-0 gap-2 text-[10px] tabular-nums text-muted-foreground'>
                <span>x{count}</span>
                <span className='font-mono'>{fmtMs(avg)}</span>
              </div>
            </div>
          )
        })}
      </PanelSection>
    </div>
  )
}

// ── Overview bar chart (header) ──

function OverviewBarChart({ requests, totalRequests, selectedIdx, onSelect }: {
  requests: RequestEntry[]
  totalRequests: number
  selectedIdx: number | null
  onSelect: (chronIdx: number | null) => void
}) {
  const chartData = useMemo(
    () => requests.map((req, i) => ({
      index: i,
      procedure: req.procedures.map((p) => p.procedure).join(', '),
      duration: req.durationMs,
      status: req.status,
      isError: req.status >= 400,
    })),
    [requests],
  )

  const selectedChronIdx = selectedIdx !== null ? totalRequests - 1 - selectedIdx : null

  const handleClick = useCallback(
    (_: unknown, idx: number) => {
      const revIdx = totalRequests - 1 - idx
      onSelect(selectedIdx === revIdx ? null : idx)
    },
    [totalRequests, selectedIdx, onSelect],
  )

  return (
    <div className='border-b px-5'>
      <ChartContainer config={OVERVIEW_CHART_CONFIG} className='h-12 w-full'>
        <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={1}>
          <ChartTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const d = payload[0].payload as (typeof chartData)[number]
              return (
                <div className='rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm'>
                  <div className='font-semibold'>{d.procedure}</div>
                  <div className='text-muted-foreground'>{fmtMs(d.duration)} &middot; {d.status}</div>
                </div>
              )
            }}
          />
          <Bar dataKey='duration' radius={[2, 2, 0, 0]} cursor='pointer' onClick={handleClick}>
            {chartData.map((entry, i) => (
              <Cell
                key={entry.index}
                fill={entry.isError ? 'var(--color-destructive)' : 'var(--chart-1)'}
                fillOpacity={selectedChronIdx === i ? 1 : entry.isError ? 0.6 : 0.3}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── Timing donut chart ──

function TimingDonut({ byKind, appMs, totalMs }: { byKind: Map<string, number>; appMs: number; totalMs: number }) {
  const data = useMemo(() => {
    const items = [...byKind].map(([kind, ms]) => ({ name: kind, value: ms, fill: KIND_HEX[kind] ?? '#a1a1aa' }))
    if (appMs > 0.1) items.push({ name: 'app', value: appMs, fill: '#3f3f46' })
    return items
  }, [byKind, appMs])

  return (
    <div className='flex items-center gap-4'>
      <ChartContainer config={{ value: { label: 'Time' } }} className='h-24 w-24 shrink-0'>
        <PieChart>
          <Pie data={data} dataKey='value' nameKey='name' cx='50%' cy='50%' innerRadius={22} outerRadius={38} strokeWidth={1} stroke='var(--background)'>
            {data.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
          </Pie>
          <text x='50%' y='50%' textAnchor='middle' dominantBaseline='middle' className='fill-foreground text-[10px] font-semibold'>
            {fmtMs(totalMs)}
          </text>
          <ChartTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const d = payload[0].payload as (typeof data)[number]
              return (
                <div className='rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm'>
                  <span className='font-semibold'>{d.name}</span>
                  <span className='ml-2 text-muted-foreground'>{d.value.toFixed(1)}ms</span>
                  <span className='ml-1 text-muted-foreground'>({((d.value / totalMs) * 100).toFixed(0)}%)</span>
                </div>
              )
            }}
          />
        </PieChart>
      </ChartContainer>
      <div className='flex flex-col gap-1'>
        {data.map((entry) => (
          <div key={entry.name} className='flex items-center gap-1.5 text-[10px]'>
            <div className='size-2 shrink-0 rounded-full' style={{ backgroundColor: entry.fill }} />
            <span className='text-muted-foreground'>{entry.name}</span>
            <span className='font-mono tabular-nums'>{entry.value.toFixed(1)}ms</span>
            <span className='text-muted-foreground/50'>{((entry.value / totalMs) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared primitives ──

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='border-r px-4 py-2.5 last:border-r-0'>
      <div className='text-[10px] font-semibold text-muted-foreground'>{label}</div>
      <div className={cn('mt-0.5 text-base font-semibold tabular-nums tracking-tight', danger && 'text-destructive')}>{value}</div>
    </div>
  )
}

function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='border-b px-4 py-3 last:border-b-0'>
      <h4 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>{label}</h4>
      {children}
    </div>
  )
}

function PanelKV({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='flex items-center justify-between py-1 text-[10px]'>
      <span className='text-muted-foreground'>{label}</span>
      <span className={cn('max-w-[60%] truncate font-mono', danger && 'text-destructive')}>{value}</span>
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
