import { SearchField } from '@/components/dashboard-shell'
import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { filterRequests, getProcedureOptions } from '@/lib/list-filters'
import { cn } from '@/lib/utils'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useMemo, useState } from 'react'
import { Bar, BarChart, Cell } from 'recharts'

import type { ChartConfig } from '@/components/ui/chart'
import type { RequestLatencyFilter, RequestStatusFilter } from '@/lib/list-filters'
import type { RequestEntry } from '@/lib/types'

// ── Constants ──

type SortKey = 'time' | 'procedure' | 'status' | 'duration' | 'spans'

const CHART_CONFIG = { duration: { label: 'Duration', color: 'var(--chart-1)' } } satisfies ChartConfig

// ── Main component ──

interface RequestsProps {
  requests: RequestEntry[]
  navigate: (page: string, id?: string) => void
  initialProcedure?: string
}

export function Requests({ requests, navigate, initialProcedure }: RequestsProps) {
  const [query, setQuery] = useState('')
  const [procedure, setProcedure] = useState(initialProcedure || 'all')
  const [status, setStatus] = useState<RequestStatusFilter>('all')
  const [latency, setLatency] = useState<RequestLatencyFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(key === 'procedure')
      return key
    })
  }, [])

  const procedures = useMemo(
    () => getProcedureOptions(requests.flatMap((e) => e.procedures.map((p) => p.procedure))),
    [requests],
  )

  const filtered = useMemo(() => {
    const result = filterRequests(requests, { query, procedure, status, latency }).toReversed()
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      switch (sortKey) {
        case 'time':
          return dir * (a.timestamp - b.timestamp)
        case 'procedure':
          return dir * (a.procedures[0]?.procedure ?? '').localeCompare(b.procedures[0]?.procedure ?? '')
        case 'status':
          return dir * (a.status - b.status)
        case 'duration':
          return dir * (a.durationMs - b.durationMs)
        case 'spans':
          return (
            dir *
            (a.procedures.reduce((s, p) => s + p.spans.length, 0) -
              b.procedures.reduce((s, p) => s + p.spans.length, 0))
          )
      }
    })
    return result
  }, [requests, query, procedure, status, latency, sortKey, sortAsc])

  const hasActiveFilters = query.length > 0 || procedure !== 'all' || status !== 'all' || latency !== 'all'
  const clearFilters = useCallback(() => {
    setQuery('')
    setProcedure('all')
    setStatus('all')
    setLatency('all')
  }, [])

  const maxDuration = useMemo(() => Math.max(...filtered.map((r) => r.durationMs), 0.1), [filtered])
  const selectedReq = selectedIdx !== null ? filtered[selectedIdx] : null

  if (requests.length === 0) {
    return (
      <div className='flex min-h-60 flex-col items-center justify-center gap-1 text-center'>
        <p className='text-sm font-semibold'>No traced requests yet</p>
        <p className='text-xs text-muted-foreground'>Requests appear once the collector sees traffic.</p>
      </div>
    )
  }

  return (
    <div className='flex min-h-full flex-col'>
      {/* ── Filter bar ── */}
      <div className='flex flex-col gap-2 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-1 flex-wrap items-center gap-2'>
          <SearchField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search procedures...'
            className='sm:max-w-56'
          />
          <Select value={procedure} onValueChange={(v) => setProcedure(v ?? 'all')}>
            <SelectTrigger size='sm' className='w-full sm:w-40'>
              <SelectValue placeholder='All procedures' />
            </SelectTrigger>
            <SelectContent align='start'>
              <SelectGroup>
                <SelectLabel>Procedure</SelectLabel>
                <SelectItem value='all'>All procedures</SelectItem>
                {procedures.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <ToggleGroup
            value={status}
            onValueChange={(v) => setStatus((v as RequestStatusFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
          >
            <ToggleGroupItem value='all'>All</ToggleGroupItem>
            <ToggleGroupItem value='success'>2xx</ToggleGroupItem>
            <ToggleGroupItem value='client'>4xx</ToggleGroupItem>
            <ToggleGroupItem value='server'>5xx</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            value={latency}
            onValueChange={(v) => setLatency((v as RequestLatencyFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
          >
            <ToggleGroupItem value='all'>All</ToggleGroupItem>
            <ToggleGroupItem value='fast'>Fast</ToggleGroupItem>
            <ToggleGroupItem value='slow'>Slow</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-[11px] tabular-nums text-muted-foreground'>
            {filtered.length} of {requests.length}
          </span>
          {hasActiveFilters && (
            <Button variant='ghost' size='xs' onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Overview bar chart ── */}
      {filtered.length > 0 && (
        <div className='border-b px-5'>
          <ChartContainer config={CHART_CONFIG} className='h-10 w-full'>
            <BarChart
              data={filtered.map((r, i) => ({ i, d: r.durationMs, err: r.status >= 400 }))}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
              barGap={1}
            >
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const idx = (payload[0].payload as { i: number }).i
                  const r = filtered[idx]!
                  return (
                    <div className='rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm'>
                      <div className='font-semibold'>{r.procedures.map((p) => p.procedure).join(', ')}</div>
                      <div className='text-muted-foreground'>
                        {fmtMs(r.durationMs)} &middot; {r.status}
                      </div>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey='d'
                radius={[2, 2, 0, 0]}
                cursor='pointer'
                onClick={(_, idx) => setSelectedIdx(selectedIdx === idx ? null : idx)}
              >
                {filtered.map((r, i) => (
                  <Cell
                    key={i}
                    fill={r.status >= 400 ? 'var(--color-destructive)' : 'var(--chart-1)'}
                    fillOpacity={selectedIdx === i ? 1 : r.status >= 400 ? 0.6 : 0.3}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {/* ── Body: list + right panel ── */}
      {filtered.length === 0 ? (
        <div className='flex min-h-48 flex-col items-center justify-center gap-1 text-center'>
          <p className='text-sm font-semibold'>No matching requests</p>
          <p className='text-xs text-muted-foreground'>
            {hasActiveFilters ? 'Adjust filters.' : 'Waiting for traffic.'}
          </p>
          {hasActiveFilters && (
            <Button variant='outline' size='xs' className='mt-2' onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className='flex flex-1 overflow-hidden'>
          {/* Request list */}
          <div className={cn('flex-1 overflow-y-auto', selectedReq && 'hidden xl:block')}>
            {/* Header row */}
            <div className='flex items-center gap-2 border-b px-5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground'>
              <SortCol
                label='Time'
                sortKey='time'
                currentKey={sortKey}
                asc={sortAsc}
                onSort={handleSort}
                className='w-14'
              />
              <span className='w-2' />
              <span className='w-8'>Method</span>
              <SortCol
                label='Procedure'
                sortKey='procedure'
                currentKey={sortKey}
                asc={sortAsc}
                onSort={handleSort}
                className='flex-1'
              />
              <SortCol
                label='Status'
                sortKey='status'
                currentKey={sortKey}
                asc={sortAsc}
                onSort={handleSort}
                className='w-12'
              />
              <span className='hidden w-28 lg:block'>Waterfall</span>
              <SortCol
                label='Duration'
                sortKey='duration'
                currentKey={sortKey}
                asc={sortAsc}
                onSort={handleSort}
                className='w-14 text-right'
              />
              <SortCol
                label='Spans'
                sortKey='spans'
                currentKey={sortKey}
                asc={sortAsc}
                onSort={handleSort}
                className='w-8 text-right'
              />
              <span className='w-16'>Session</span>
            </div>
            {filtered.map((entry, idx) => {
              const spanCount = entry.procedures.reduce((s, p) => s + p.spans.length, 0)
              const isError = entry.status >= 400
              const durationPct = (entry.durationMs / maxDuration) * 100
              return (
                <ContextMenu key={entry.id}>
                <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    'flex cursor-pointer items-center gap-2 border-b border-dashed px-5 py-2 hover:bg-muted/20',
                    selectedIdx === idx && 'bg-primary/5',
                  )}
                  onClick={() => setSelectedIdx(selectedIdx === idx ? null : idx)}
                  onDoubleClick={() => navigate('requests', String(entry.id))}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground'>
                        {fmtRelativeTime(entry.timestamp)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='right' className='text-xs'>
                      {fmtTime(entry.timestamp)}
                    </TooltipContent>
                  </Tooltip>
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', isError ? 'bg-destructive' : 'bg-emerald-500')}
                  />
                  <span className='w-8 shrink-0 font-mono text-[10px] text-muted-foreground'>{entry.method}</span>
                  <span className='min-w-0 flex-1 truncate font-mono text-[11px] font-semibold'>
                    {entry.procedures.map((p) => p.procedure).join(', ')}
                    {entry.isBatch && (
                      <Badge variant='outline' className='ml-1.5 text-[9px]'>
                        batch
                      </Badge>
                    )}
                  </span>
                  <Badge variant={isError ? 'destructive' : 'secondary'} className='w-12 justify-center text-[9px]'>
                    {entry.status}
                  </Badge>
                  <div className='hidden w-28 lg:block'>
                    <div className='h-1.5 w-full rounded-full bg-muted'>
                      <div
                        className={cn('h-full rounded-full', isError ? 'bg-destructive/50' : 'bg-primary/40')}
                        style={{ width: `${Math.max(durationPct, 2)}%` }}
                      />
                    </div>
                  </div>
                  <span className='w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground'>
                    {fmtMs(entry.durationMs)}
                  </span>
                  <span className='w-8 shrink-0 text-right font-mono text-[9px] text-muted-foreground/50'>
                    {spanCount || ''}
                  </span>
                  <Badge
                    variant='outline'
                    className='w-16 cursor-pointer justify-center font-mono text-[9px] hover:bg-muted'
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate('sessions', entry.sessionId)
                    }}
                  >
                    {entry.sessionId?.slice(0, 8) ?? '-'}
                  </Badge>
                </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => navigate('requests', String(entry.id))}>
                    View details
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => navigate('sessions', entry.sessionId)}>
                    View session
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      fetch('/api/analytics/hidden', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ path: entry.path }),
                      })
                    }}
                    className='text-destructive'
                  >
                    Hide path
                  </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>

          {/* Right panel */}
          <div
            className={cn('flex w-full flex-col border-l xl:w-[420px] xl:shrink-0', !selectedReq && 'hidden xl:flex')}
          >
            {selectedReq ? (
              <RequestDetailPanel req={selectedReq} onClose={() => setSelectedIdx(null)} navigate={navigate} />
            ) : (
              <div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
                Select a request to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Request detail panel ──

function RequestDetailPanel({
  req,
  onClose,
  navigate,
}: {
  req: RequestEntry
  onClose: () => void
  navigate: (page: string, id?: string) => void
}) {
  return (
    <>
      <div className='flex items-center gap-2 border-b px-4 py-2'>
        <span
          className={cn('size-1.5 shrink-0 rounded-full', req.status >= 400 ? 'bg-destructive' : 'bg-emerald-500')}
        />
        <span className='flex-1 truncate font-mono text-[11px] font-semibold'>
          {req.procedures.map((p) => p.procedure).join(', ')}
        </span>
        <Badge variant={req.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
          {req.status}
        </Badge>
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
                <Badge variant={proc.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
                  {proc.status}
                </Badge>
                <span className='text-muted-foreground'>{fmtMs(proc.durationMs)}</span>
              </div>
            )}
            {proc.spans.length > 0 && (
              <PanelSection label='Spans'>
                <SpanWaterfall spans={proc.spans} totalMs={proc.durationMs} />
              </PanelSection>
            )}
            {proc.input !== undefined && proc.input !== null && (
              <PanelSection label='Input'>
                <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
                  {JSON.stringify(proc.input, null, 2)}
                </pre>
              </PanelSection>
            )}
            {proc.output !== undefined && proc.output !== null && (
              <PanelSection label='Output'>
                <pre className='max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
                  {JSON.stringify(proc.output, null, 2)}
                </pre>
              </PanelSection>
            )}
            {proc.error && (
              <PanelSection label='Error'>
                <div className='rounded-md bg-destructive/10 px-2.5 py-2 font-mono text-[10px] text-destructive'>
                  {proc.error}
                </div>
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
        <Button variant='outline' size='xs' className='w-full' onClick={() => navigate('requests', String(req.id))}>
          Open full detail
        </Button>
      </div>
      </div>
    </>
  )
}

// ── Shared primitives ──

function SortCol({
  label,
  sortKey,
  currentKey,
  asc,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  asc: boolean
  onSort: (k: SortKey) => void
  className?: string
}) {
  return (
    <span
      className={cn('cursor-pointer select-none', currentKey === sortKey && 'text-primary', className)}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {currentKey === sortKey && (asc ? ' ↑' : ' ↓')}
    </span>
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
