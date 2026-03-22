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
import { Bar, BarChart, Cell } from 'recharts'

import type { ChartConfig } from '@/components/ui/chart'
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
  const maxDuration = Math.max(...sessionRequests.map((r) => r.durationMs), 0.1)

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
      <div className='grid grid-cols-3 gap-x-0 border-b xl:grid-cols-6'>
        <Stat label='Requests' value={String(sessionRequests.length)} />
        <Stat label='Errors' value={String(errorCount)} danger={errorCount > 0} />
        <Stat label='Avg latency' value={fmtMs(totalMs / sessionRequests.length)} />
        <Stat label='Total CPU' value={fmtMs(totalMs)} />
        <Stat label='Duration' value={fmtMs(wallClockMs)} />
        <Stat label='Spans' value={String(allSpans.length)} />
      </div>

      {/* Mini overview chart */}
      <SessionOverviewChart
        requests={chronological}
        totalRequests={sessionRequests.length}
        selectedIdx={selectedIdx}
        onSelect={(chronIdx) => setSelectedIdx(chronIdx !== null ? sessionRequests.length - 1 - chronIdx : null)}
      />

      {/* Main content: full-width request list + optional right panel */}
      <div className='flex flex-1 overflow-hidden'>
        {/* Request list */}
        <div className={cn('flex-1 overflow-y-auto', selectedReq && 'hidden xl:block')}>
          <div className='flex flex-col'>
            {sessionRequests.map((req, idx) => {
              const spanCount = req.procedures.reduce((s, p) => s + p.spans.length, 0)
              const isSelected = selectedIdx === idx
              const isError = req.status >= 400
              const durationPct = (req.durationMs / maxDuration) * 100

              return (
                <div
                  key={req.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 border-b border-dashed px-5 py-2 hover:bg-muted/20',
                    isSelected && 'bg-primary/5',
                  )}
                  onClick={() => setSelectedIdx(isSelected ? null : idx)}
                >
                  {/* Time */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground'>
                        {fmtRelativeTime(req.timestamp)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='right' className='text-xs'>{fmtTime(req.timestamp)}</TooltipContent>
                  </Tooltip>

                  {/* Status dot */}
                  <span className={cn('size-1.5 shrink-0 rounded-full', isError ? 'bg-destructive' : 'bg-emerald-500')} />

                  {/* Method */}
                  <span className='w-8 shrink-0 font-mono text-[10px] text-muted-foreground'>{req.method}</span>

                  {/* Procedure name */}
                  <span className='min-w-0 flex-1 truncate font-mono text-[11px] font-semibold'>
                    {req.procedures.map((p) => p.procedure).join(', ')}
                  </span>

                  {/* Status */}
                  <Badge variant={isError ? 'destructive' : 'secondary'} className='text-[9px]'>
                    {req.status}
                  </Badge>

                  {/* Waterfall bar */}
                  <div className='hidden w-28 lg:block'>
                    <div className='h-1.5 w-full rounded-full bg-muted'>
                      <div
                        className={cn(
                          'h-full rounded-full',
                          isError ? 'bg-destructive/50' : 'bg-primary/40',
                        )}
                        style={{ width: `${Math.max(durationPct, 2)}%` }}
                      />
                    </div>
                  </div>

                  {/* Duration */}
                  <span className='w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground'>
                    {fmtMs(req.durationMs)}
                  </span>

                  {/* Spans */}
                  <span className='w-4 shrink-0 text-right font-mono text-[9px] text-muted-foreground/50'>
                    {spanCount || ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right detail panel — slides in when a request is selected */}
        {selectedReq && (
          <div className='flex w-full flex-col border-l xl:w-[420px] xl:shrink-0'>
            {/* Panel header */}
            <div className='flex items-center gap-2 border-b px-4 py-2'>
              <span className='flex-1 truncate font-mono text-[11px] font-semibold'>
                {selectedReq.procedures.map((p) => p.procedure).join(', ')}
              </span>
              <Badge variant={selectedReq.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
                {selectedReq.status}
              </Badge>
              <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>
                {fmtMs(selectedReq.durationMs)}
              </span>
              <Button variant='ghost' size='icon-sm' onClick={() => setSelectedIdx(null)}>
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
              </Button>
            </div>

            {/* Panel content */}
            <div className='flex-1 overflow-y-auto'>
              {/* Waterfall */}
              {selectedReq.procedures.map((proc, idx) => (
                <div key={idx}>
                  {selectedReq.procedures.length > 1 && (
                    <div className='flex items-center gap-2 border-b bg-muted/20 px-4 py-1.5 text-[11px]'>
                      <span className='font-mono font-semibold'>{proc.procedure}</span>
                      <Badge variant={proc.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
                        {proc.status}
                      </Badge>
                      <span className='text-muted-foreground'>{fmtMs(proc.durationMs)}</span>
                    </div>
                  )}

                  {proc.spans.length > 0 && (
                    <div className='border-b px-4 py-3'>
                      <h4 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        Spans
                      </h4>
                      <SpanWaterfall spans={proc.spans} totalMs={proc.durationMs} />
                    </div>
                  )}

                  {proc.input !== undefined && proc.input !== null && (
                    <div className='border-b px-4 py-3'>
                      <h4 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        Input
                      </h4>
                      <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
                        {JSON.stringify(proc.input, null, 2)}
                      </pre>
                    </div>
                  )}

                  {proc.output !== undefined && proc.output !== null && (
                    <div className='border-b px-4 py-3'>
                      <h4 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        Output
                      </h4>
                      <pre className='max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
                        {JSON.stringify(proc.output, null, 2)}
                      </pre>
                    </div>
                  )}

                  {proc.error && (
                    <div className='border-b px-4 py-3'>
                      <h4 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        Error
                      </h4>
                      <div className='rounded-md bg-destructive/10 px-2.5 py-2 font-mono text-[10px] text-destructive'>
                        {proc.error}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Request metadata */}
              <div className='border-b px-4 py-3'>
                <h4 className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                  Request
                </h4>
                <div className='flex flex-col'>
                  <PanelKV label='method' value={selectedReq.method} />
                  <PanelKV label='path' value={selectedReq.path} />
                  <PanelKV label='status' value={String(selectedReq.status)} danger={selectedReq.status >= 400} />
                  <PanelKV label='duration' value={fmtMs(selectedReq.durationMs)} />
                  <PanelKV label='time' value={fmtTime(selectedReq.timestamp)} />
                  <PanelKV label='ip' value={selectedReq.ip || '-'} />
                </div>
              </div>

              {/* Open full detail */}
              <div className='px-4 py-3'>
                <Button
                  variant='outline'
                  size='xs'
                  className='w-full'
                  onClick={() => navigate('requests', String(selectedReq.id))}
                >
                  Open full detail
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Session overview chart ──

const overviewChartConfig = {
  duration: { label: 'Duration', color: 'var(--chart-1)' },
} satisfies ChartConfig

function SessionOverviewChart({
  requests,
  totalRequests,
  selectedIdx,
  onSelect,
}: {
  requests: RequestEntry[]
  totalRequests: number
  selectedIdx: number | null
  onSelect: (chronIdx: number | null) => void
}) {
  const chartData = useMemo(
    () =>
      requests.map((req, i) => ({
        index: i,
        procedure: req.procedures.map((p) => p.procedure).join(', '),
        duration: req.durationMs,
        status: req.status,
        isError: req.status >= 400,
      })),
    [requests],
  )

  const handleClick = useCallback(
    (_: unknown, idx: number) => {
      const revIdx = totalRequests - 1 - idx
      onSelect(selectedIdx === revIdx ? null : idx)
    },
    [totalRequests, selectedIdx, onSelect],
  )

  // The selected bar in chronological index
  const selectedChronIdx = selectedIdx !== null ? totalRequests - 1 - selectedIdx : null

  return (
    <div className='border-b px-5'>
      <ChartContainer config={overviewChartConfig} className='h-12 w-full'>
        <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={1}>
          <ChartTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const d = payload[0].payload as (typeof chartData)[number]
              return (
                <div className='rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm'>
                  <div className='font-semibold'>{d.procedure}</div>
                  <div className='text-muted-foreground'>
                    {fmtMs(d.duration)} &middot; {d.status}
                  </div>
                </div>
              )
            }}
          />
          <Bar
            dataKey='duration'
            radius={[2, 2, 0, 0]}
            cursor='pointer'
            onClick={handleClick}
          >
            {chartData.map((entry, i) => (
              <Cell
                key={entry.index}
                fill={
                  entry.isError
                    ? 'var(--color-destructive)'
                    : selectedChronIdx === i
                      ? 'var(--chart-1)'
                      : 'var(--chart-1)'
                }
                fillOpacity={selectedChronIdx === i ? 1 : entry.isError ? 0.6 : 0.3}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── Shared components ──

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='border-r px-4 py-2.5 last:border-r-0'>
      <div className='text-[10px] font-semibold text-muted-foreground'>{label}</div>
      <div className={cn('mt-0.5 text-base font-semibold tabular-nums tracking-tight', danger && 'text-destructive')}>
        {value}
      </div>
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
