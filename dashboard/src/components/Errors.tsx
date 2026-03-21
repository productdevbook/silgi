import { EmptyState, InsightPill, PageHero, PageShell, SearchField, SectionCard } from '@/components/dashboard-shell'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { fmtMs, fmtTime } from '@/lib/format'
import { filterErrors, getProcedureOptions, summarizeErrors } from '@/lib/list-filters'
import { cn } from '@/lib/utils'
import { useCallback, useMemo, useState } from 'react'

import type { ErrorSeverityFilter, ErrorTraceFilter } from '@/lib/list-filters'
import type { ErrorEntry } from '@/lib/types'

type SortKey = 'time' | 'procedure' | 'code' | 'status' | 'duration'

const COLUMNS: readonly { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'time', label: 'Time', align: 'left' },
  { key: 'procedure', label: 'Procedure', align: 'left' },
  { key: 'code', label: 'Code', align: 'left' },
  { key: 'status', label: 'Status', align: 'right' },
  { key: 'duration', label: 'Duration', align: 'right' },
] as const

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

interface ErrorsProps {
  errors: ErrorEntry[]
  navigate: (page: string, id?: string) => void
}

export function Errors({ errors, navigate }: ErrorsProps) {
  const [query, setQuery] = useState('')
  const [procedure, setProcedure] = useState('all')
  const [severity, setSeverity] = useState<ErrorSeverityFilter>('all')
  const [trace, setTrace] = useState<ErrorTraceFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(key === 'procedure' || key === 'code')
      return key
    })
  }, [])

  const procedures = useMemo(() => getProcedureOptions(errors.map((entry) => entry.procedure)), [errors])

  const filtered = useMemo(() => {
    let result = filterErrors(errors, {
      query,
      procedure,
      severity,
      trace,
    }).toReversed()
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb)
      return dir * String(va).localeCompare(String(vb))
    })
    return result
  }, [errors, query, procedure, severity, trace, sortKey, sortAsc])

  const summary = useMemo(() => summarizeErrors(errors), [errors])
  const filteredSummary = useMemo(() => summarizeErrors(filtered), [filtered])
  const hasActiveFilters = query.length > 0 || procedure !== 'all' || severity !== 'all' || trace !== 'all'

  const activeFilters = useMemo(() => {
    return [
      procedure !== 'all' ? `Procedure: ${procedure}` : null,
      severity !== 'all' ? `Severity: ${getErrorSeverityLabel(severity)}` : null,
      trace !== 'all' ? `Trace: ${getErrorTraceLabel(trace)}` : null,
      query ? `Search: ${query}` : null,
    ].filter(Boolean) as string[]
  }, [procedure, severity, trace, query])

  const clearFilters = useCallback(() => {
    setQuery('')
    setProcedure('all')
    setSeverity('all')
    setTrace('all')
  }, [])

  if (errors.length === 0) {
    return (
      <PageShell>
        <EmptyState
          title='No errors recorded'
          description='When a procedure throws, the full request context and trace data will appear here.'
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHero
        eyebrow='Errors'
        title='Captured failure stream'
        description='Search the recent failure log, then jump from the timeline into full request context and span timing.'
        badges={
          <>
            <Badge variant='destructive'>{errors.length} failures</Badge>
            <Badge variant='secondary'>{summary.uniqueCodes} error codes</Badge>
          </>
        }
      >
        <div className='grid gap-3 md:grid-cols-3'>
          <InsightPill label='Latest log size' value={`${errors.length}`} meta='Entries retained in memory' />
          <InsightPill label='Error code spread' value={`${summary.uniqueCodes}`} meta='Distinct error classes' />
          <InsightPill label='Slowest failing request' value={fmtMs(summary.longestDuration)} meta='Maximum duration' />
        </div>
      </PageHero>

      <SectionCard
        title='Failure log'
        subtitle='Scope the stream by procedure, severity, and traced context'
        action={
          <ErrorControls
            query={query}
            procedure={procedure}
            procedures={procedures}
            severity={severity}
            trace={trace}
            filteredCount={filtered.length}
            filteredSummary={filteredSummary}
            activeFilters={activeFilters}
            hasActiveFilters={hasActiveFilters}
            onQueryChange={setQuery}
            onProcedureChange={setProcedure}
            onSeverityChange={setSeverity}
            onTraceChange={setTrace}
            onClear={clearFilters}
          />
        }
        contentClassName='px-0 pb-0'
      >
        {filtered.length === 0 ? (
          <div className='px-6 py-10'>
            <EmptyState
              title='No matching failures'
              description={
                hasActiveFilters
                  ? 'Adjust the current filters to widen the failure stream.'
                  : 'Failures will appear here as soon as the collector captures them.'
              }
              action={
                hasActiveFilters ? (
                  <Button variant='outline' size='sm' onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
              className='border-0'
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((col) => (
                  <SortHead key={col.key} col={col} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                ))}
                <TableHead className='text-xs'>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow
                  key={entry.id}
                  onClick={() => navigate('errors', String(entry.id))}
                  className='cursor-pointer'
                >
                  <TableCell className='px-4 whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
                    {fmtTime(entry.timestamp)}
                  </TableCell>
                  <TableCell className='px-4 text-xs font-medium'>{entry.procedure}</TableCell>
                  <TableCell className='px-4'>
                    <Badge variant='destructive' className='text-[10px]'>
                      {entry.code}
                    </Badge>
                  </TableCell>
                  <TableCell className='px-4 text-right text-xs tabular-nums text-muted-foreground'>
                    {entry.status}
                  </TableCell>
                  <TableCell className='px-4 text-right text-xs tabular-nums text-muted-foreground'>
                    {fmtMs(entry.durationMs)}
                  </TableCell>
                  <TableCell className='max-w-[320px] px-4 truncate text-xs text-muted-foreground'>
                    {entry.error}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </PageShell>
  )
}

function ErrorControls({
  query,
  procedure,
  procedures,
  severity,
  trace,
  filteredCount,
  filteredSummary,
  activeFilters,
  hasActiveFilters,
  onQueryChange,
  onProcedureChange,
  onSeverityChange,
  onTraceChange,
  onClear,
}: {
  query: string
  procedure: string
  procedures: string[]
  severity: ErrorSeverityFilter
  trace: ErrorTraceFilter
  filteredCount: number
  filteredSummary: ReturnType<typeof summarizeErrors>
  activeFilters: string[]
  hasActiveFilters: boolean
  onQueryChange: (value: string) => void
  onProcedureChange: (value: string) => void
  onSeverityChange: (value: ErrorSeverityFilter) => void
  onTraceChange: (value: ErrorTraceFilter) => void
  onClear: () => void
}) {
  return (
    <div className='flex w-full flex-col gap-3'>
      <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
        <div className='flex flex-1 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center'>
          <SearchField
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder='Search messages or codes...'
            className='sm:max-w-72'
          />
          <Select value={procedure} onValueChange={onProcedureChange}>
            <SelectTrigger size='sm' className='w-full sm:w-48'>
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
            onValueChange={(value) => onSeverityChange((value as ErrorSeverityFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
            className='flex-wrap'
          >
            <ToggleGroupItem value='all'>All severities</ToggleGroupItem>
            <ToggleGroupItem value='client'>4xx</ToggleGroupItem>
            <ToggleGroupItem value='server'>5xx</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            value={trace}
            onValueChange={(value) => onTraceChange((value as ErrorTraceFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
            className='flex-wrap'
          >
            <ToggleGroupItem value='all'>All traces</ToggleGroupItem>
            <ToggleGroupItem value='traced'>With spans</ToggleGroupItem>
            <ToggleGroupItem value='untraced'>No spans</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {hasActiveFilters && (
          <Button variant='ghost' size='sm' onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant='outline'>{filteredCount} results</Badge>
        <Badge variant='secondary'>{filteredSummary.uniqueProcedures} procedures</Badge>
        <Badge variant='secondary'>{filteredSummary.tracedCount} traced</Badge>
        <Badge variant='secondary'>{filteredSummary.uniqueCodes} codes</Badge>
        {activeFilters.map((item) => (
          <Badge key={item} variant='outline'>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function getErrorSeverityLabel(filter: ErrorSeverityFilter) {
  switch (filter) {
    case 'client':
      return '4xx'
    case 'server':
      return '5xx'
    default:
      return 'All'
  }
}

function getErrorTraceLabel(filter: ErrorTraceFilter) {
  switch (filter) {
    case 'traced':
      return 'With spans'
    case 'untraced':
      return 'No spans'
    default:
      return 'All'
  }
}

function SortHead({
  col,
  sortKey,
  sortAsc,
  onSort,
}: {
  col: { key: SortKey; label: string; align: string }
  sortKey: string
  sortAsc: boolean
  onSort: (k: SortKey) => void
}) {
  return (
    <TableHead
      onClick={() => onSort(col.key)}
      className={cn(
        'cursor-pointer select-none px-4 text-xs',
        col.align === 'right' && 'text-right',
        sortKey === col.key && 'text-primary',
      )}
    >
      {col.label}
      {sortKey === col.key && (sortAsc ? ' ↑' : ' ↓')}
    </TableHead>
  )
}
