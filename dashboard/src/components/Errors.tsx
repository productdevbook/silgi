import { SearchField } from '@/components/dashboard-shell'
import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { filterErrors, getProcedureOptions } from '@/lib/list-filters'
import { cn } from '@/lib/utils'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useMemo, useState } from 'react'

import type { ErrorSeverityFilter, ErrorTraceFilter } from '@/lib/list-filters'
import type { ErrorEntry } from '@/lib/types'

// ── Constants ──

type SortKey = 'time' | 'procedure' | 'code' | 'status' | 'duration'

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-api-key'])

function getSortValue(entry: ErrorEntry, key: SortKey): string | number {
  switch (key) {
    case 'time':
      return entry.timestamp
    case 'procedure':
      return entry.procedure
    case 'code':
      return entry.code
    case 'status':
      return entry.status
    case 'duration':
      return entry.durationMs
  }
}

// ── Main component ──

interface ErrorsProps {
  errors: ErrorEntry[]
  navigate: (page: string, id?: string) => void
  initialProcedure?: string
}

export function Errors({ errors, navigate, initialProcedure }: ErrorsProps) {
  const [query, setQuery] = useState('')
  const [procedure, setProcedure] = useState(initialProcedure || 'all')
  const [severity, setSeverity] = useState<ErrorSeverityFilter>('all')
  const [trace, setTrace] = useState<ErrorTraceFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(key === 'procedure' || key === 'code')
      return key
    })
  }, [])

  const procedures = useMemo(() => getProcedureOptions(errors.map((e) => e.procedure)), [errors])

  const filtered = useMemo(() => {
    const result = filterErrors(errors, { query, procedure, severity, trace }).toReversed()
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb)
      return dir * String(va).localeCompare(String(vb))
    })
    return result
  }, [errors, query, procedure, severity, trace, sortKey, sortAsc])

  const hasActiveFilters = query.length > 0 || procedure !== 'all' || severity !== 'all' || trace !== 'all'
  const clearFilters = useCallback(() => {
    setQuery('')
    setProcedure('all')
    setSeverity('all')
    setTrace('all')
  }, [])

  const selectedErr = selectedIdx !== null ? filtered[selectedIdx] : null

  // Error summary for idle panel
  const summary = useMemo(() => {
    const byCodes = new Map<string, number>()
    const byProc = new Map<string, number>()
    let clientCount = 0
    let serverCount = 0
    for (const e of errors) {
      byCodes.set(e.code, (byCodes.get(e.code) ?? 0) + 1)
      byProc.set(e.procedure, (byProc.get(e.procedure) ?? 0) + 1)
      if (e.status >= 500) serverCount++
      else clientCount++
    }
    return {
      byCodes: [...byCodes].toSorted((a, b) => b[1] - a[1]),
      byProc: [...byProc].toSorted((a, b) => b[1] - a[1]),
      clientCount,
      serverCount,
      tracedCount: errors.filter((e) => e.spans.length > 0).length,
    }
  }, [errors])

  if (errors.length === 0) {
    return (
      <div className='flex min-h-60 flex-col items-center justify-center gap-1 text-center'>
        <p className='text-sm font-semibold'>No errors recorded</p>
        <p className='text-xs text-muted-foreground'>Failures will appear here when captured.</p>
      </div>
    )
  }

  return (
    <div className='flex min-h-full flex-col'>
      {/* ── Stat strip ── */}
      <div className='grid grid-cols-2 gap-x-0 border-b xl:grid-cols-5'>
        <Stat label='Total errors' value={String(errors.length)} danger />
        <Stat label='Client (4xx)' value={String(summary.clientCount)} />
        <Stat label='Server (5xx)' value={String(summary.serverCount)} danger={summary.serverCount > 0} />
        <Stat label='Traced' value={String(summary.tracedCount)} />
        <Stat label='Procedures' value={String(summary.byProc.length)} />
      </div>

      {/* ── Error codes strip ── */}
      <div className='flex items-center gap-3 border-b px-4 py-2'>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Codes</span>
        {summary.byCodes.map(([code, count]) => (
          <Badge key={code} variant='destructive' className='text-[9px]'>
            {code} <span className='ml-1 opacity-70'>{count}</span>
          </Badge>
        ))}
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ml-auto'>Top</span>
        {summary.byProc.slice(0, 3).map(([proc, count]) => (
          <span key={proc} className='font-mono text-[10px] text-muted-foreground'>
            {proc} <span className='text-destructive'>{count}</span>
          </span>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className='flex flex-col gap-2 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-1 flex-wrap items-center gap-2'>
          <SearchField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search errors...'
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
            value={severity}
            onValueChange={(v) => setSeverity((v as ErrorSeverityFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
          >
            <ToggleGroupItem value='all'>All</ToggleGroupItem>
            <ToggleGroupItem value='client'>4xx</ToggleGroupItem>
            <ToggleGroupItem value='server'>5xx</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            value={trace}
            onValueChange={(v) => setTrace((v as ErrorTraceFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
          >
            <ToggleGroupItem value='all'>All</ToggleGroupItem>
            <ToggleGroupItem value='traced'>Traced</ToggleGroupItem>
            <ToggleGroupItem value='untraced'>Untraced</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-[11px] tabular-nums text-muted-foreground'>
            {filtered.length} of {errors.length}
          </span>
          {hasActiveFilters && (
            <Button variant='ghost' size='xs' onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Body: list + right panel ── */}
      {filtered.length === 0 ? (
        <div className='flex min-h-48 flex-col items-center justify-center gap-1 text-center'>
          <p className='text-sm font-semibold'>No matching failures</p>
          <p className='text-xs text-muted-foreground'>
            {hasActiveFilters ? 'Adjust filters.' : 'Waiting for errors.'}
          </p>
          {hasActiveFilters && (
            <Button variant='outline' size='xs' className='mt-2' onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className='flex flex-1 overflow-hidden'>
          {/* Error list */}
          <div className={cn('flex-1 overflow-y-auto', selectedErr && 'hidden xl:block')}>
            {filtered.map((entry, idx) => (
              <div
                key={entry.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 border-b border-dashed px-5 py-2.5 hover:bg-muted/20',
                  selectedIdx === idx && 'bg-destructive/5',
                )}
                onClick={() => setSelectedIdx(selectedIdx === idx ? null : idx)}
              >
                {/* Left: status indicator */}
                <span className='mt-1 size-1.5 shrink-0 rounded-full bg-destructive' />

                {/* Center: main content */}
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-mono text-[11px] font-semibold'>{entry.procedure}</span>
                    <Badge variant='destructive' className='text-[9px]'>
                      {entry.code}
                    </Badge>
                    <span className='text-[10px] tabular-nums text-muted-foreground'>{entry.status}</span>
                  </div>
                  <p className='mt-0.5 truncate text-[11px] text-muted-foreground'>{entry.error}</p>
                </div>

                {/* Right: time + duration */}
                <div className='shrink-0 text-right'>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='text-[11px] tabular-nums text-muted-foreground'>
                        {fmtRelativeTime(entry.timestamp)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='left' className='text-xs'>
                      {fmtTime(entry.timestamp)}
                    </TooltipContent>
                  </Tooltip>
                  <div className='font-mono text-[10px] tabular-nums text-muted-foreground/60'>
                    {fmtMs(entry.durationMs)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right panel: error summary (idle) or error detail (selected) */}
          <div
            className={cn('flex w-full flex-col border-l xl:w-[420px] xl:shrink-0', !selectedErr && 'hidden xl:flex')}
          >
            {selectedErr ? (
              <ErrorDetailPanel entry={selectedErr} onClose={() => setSelectedIdx(null)} navigate={navigate} />
            ) : (
              <ErrorSummaryPanel summary={summary} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Error summary panel (idle state) ──

function ErrorSummaryPanel({
  summary,
}: {
  summary: {
    byCodes: [string, number][]
    byProc: [string, number][]
    clientCount: number
    serverCount: number
    tracedCount: number
  }
}) {
  return (
    <div className='flex-1 overflow-y-auto'>
      <PanelSection label='Error codes'>
        {summary.byCodes.map(([code, count]) => (
          <div key={code} className='flex items-center justify-between border-b border-dashed py-1.5 last:border-0'>
            <Badge variant='destructive' className='text-[9px]'>
              {code}
            </Badge>
            <span className='font-mono text-[10px] tabular-nums text-muted-foreground'>{count}</span>
          </div>
        ))}
      </PanelSection>

      <PanelSection label='Top procedures'>
        {summary.byProc.slice(0, 10).map(([proc, count]) => (
          <div
            key={proc}
            className='flex items-center justify-between gap-2 border-b border-dashed py-1.5 last:border-0'
          >
            <span className='min-w-0 truncate font-mono text-[10px] font-semibold'>{proc}</span>
            <span className='shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground'>{count}</span>
          </div>
        ))}
      </PanelSection>

      <PanelSection label='Breakdown'>
        <PanelKV label='client (4xx)' value={String(summary.clientCount)} />
        <PanelKV label='server (5xx)' value={String(summary.serverCount)} danger={summary.serverCount > 0} />
        <PanelKV label='traced' value={String(summary.tracedCount)} />
        <PanelKV
          label='untraced'
          value={String(summary.byCodes.reduce((s, [, c]) => s + c, 0) - summary.tracedCount)}
        />
      </PanelSection>
    </div>
  )
}

// ── Error detail panel ──

function ErrorDetailPanel({
  entry,
  onClose,
  navigate,
}: {
  entry: ErrorEntry
  onClose: () => void
  navigate: (page: string, id?: string) => void
}) {
  const headerEntries = Object.entries(entry.headers ?? {})

  return (
    <>
      <div className='flex items-center gap-2 border-b px-4 py-2'>
        <span className='size-1.5 shrink-0 rounded-full bg-destructive' />
        <span className='flex-1 truncate font-mono text-[11px] font-semibold'>{entry.procedure}</span>
        <Badge variant='destructive' className='text-[9px]'>
          {entry.code}
        </Badge>
        <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>{fmtMs(entry.durationMs)}</span>
        <Button variant='ghost' size='icon-sm' onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      <div className='flex-1 overflow-y-auto'>
        <PanelSection label='Error'>
          <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-destructive/90'>
            {entry.error}
          </pre>
        </PanelSection>

        {entry.spans.length > 0 && (
          <PanelSection label={`Spans — ${entry.spans.length} ops`}>
            <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
          </PanelSection>
        )}

        {entry.stack && (
          <PanelSection label='Stack trace'>
            <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground'>
              {entry.stack}
            </pre>
          </PanelSection>
        )}

        {entry.input !== undefined && entry.input !== null && (
          <PanelSection label='Input'>
            <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 font-mono text-[10px] leading-relaxed'>
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </PanelSection>
        )}

        <PanelSection label='Metadata'>
          <PanelKV label='status' value={String(entry.status)} danger />
          <PanelKV label='code' value={entry.code} danger />
          <PanelKV label='duration' value={fmtMs(entry.durationMs)} />
          <PanelKV label='spans' value={String(entry.spans.length)} />
          <PanelKV label='time' value={fmtTime(entry.timestamp)} />
        </PanelSection>

        {headerEntries.length > 0 && (
          <PanelSection label='Headers'>
            {headerEntries.map(([key, value]) => (
              <div key={key} className='flex gap-3 border-b border-dashed py-1 last:border-0'>
                <span className='w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground'>{key}</span>
                <span className='min-w-0 break-all font-mono text-[10px]'>
                  {SENSITIVE_HEADERS.has(key.toLowerCase()) ? (
                    <span className='text-muted-foreground/40'>[redacted]</span>
                  ) : (
                    value
                  )}
                </span>
              </div>
            ))}
          </PanelSection>
        )}

        <div className='flex gap-2 px-4 py-3'>
          {entry.requestId && (
            <Button
              variant='outline'
              size='xs'
              className='flex-1'
              onClick={() => navigate('requests', entry.requestId)}
            >
              View request
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Shared primitives ──

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
