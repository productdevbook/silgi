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
import { SLOW_REQUEST_MS, filterRequests, getProcedureOptions, summarizeRequests } from '@/lib/list-filters'
import { cn } from '@/lib/utils'
import { useCallback, useMemo, useState } from 'react'

import type { RequestLatencyFilter, RequestStatusFilter } from '@/lib/list-filters'
import type { RequestEntry } from '@/lib/types'

type SortKey = 'time' | 'procedure' | 'status' | 'duration' | 'spans'

interface RequestsProps {
  requests: RequestEntry[]
  navigate: (page: string, id?: string) => void
}

export function Requests({ requests, navigate }: RequestsProps) {
  const [query, setQuery] = useState('')
  const [procedure, setProcedure] = useState('all')
  const [status, setStatus] = useState<RequestStatusFilter>('all')
  const [latency, setLatency] = useState<RequestLatencyFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(key === 'procedure')
      return key
    })
  }, [])

  const procedures = useMemo(() => getProcedureOptions(requests.map((entry) => entry.procedure)), [requests])

  const filtered = useMemo(() => {
    let result = filterRequests(requests, {
      query,
      procedure,
      status,
      latency,
    }).toReversed()
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      switch (sortKey) {
        case 'time':
          return dir * (a.timestamp - b.timestamp)
        case 'procedure':
          return dir * a.procedure.localeCompare(b.procedure)
        case 'status':
          return dir * (a.status - b.status)
        case 'duration':
          return dir * (a.durationMs - b.durationMs)
        case 'spans':
          return dir * (a.spans.length - b.spans.length)
      }
    })
    return result
  }, [requests, query, procedure, status, latency, sortKey, sortAsc])

  const summary = useMemo(() => summarizeRequests(requests), [requests])
  const filteredSummary = useMemo(() => summarizeRequests(filtered), [filtered])
  const hasActiveFilters = query.length > 0 || procedure !== 'all' || status !== 'all' || latency !== 'all'

  const activeFilters = useMemo(() => {
    return [
      procedure !== 'all' ? `Procedure: ${procedure}` : null,
      status !== 'all' ? `Status: ${getRequestStatusLabel(status)}` : null,
      latency !== 'all' ? `Latency: ${getRequestLatencyLabel(latency)}` : null,
      query ? `Search: ${query}` : null,
    ].filter(Boolean) as string[]
  }, [procedure, status, latency, query])

  const clearFilters = useCallback(() => {
    setQuery('')
    setProcedure('all')
    setStatus('all')
    setLatency('all')
  }, [])

  if (requests.length === 0) {
    return (
      <PageShell>
        <EmptyState
          title='No traced requests yet'
          description='Request snapshots appear here once the analytics collector sees live traffic.'
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHero
        eyebrow='Requests'
        title='Trace recent request flow'
        description='Use the request log as a jump-off point for span waterfalls, payload inspection, and latency analysis.'
        badges={
          <>
            <Badge variant='secondary'>{requests.length} traced requests</Badge>
            <Badge variant='secondary'>{summary.uniqueProcedures} procedures</Badge>
          </>
        }
      >
        <div className='grid gap-3 md:grid-cols-3'>
          <InsightPill label='Recent traces' value={`${requests.length}`} meta='Entries in the request log' />
          <InsightPill
            label='Average duration'
            value={fmtMs(summary.averageDuration)}
            meta='Across the current trace set'
          />
          <InsightPill label='Error responses' value={`${summary.errorCount}`} meta='Requests returning 4xx or 5xx' />
        </div>
      </PageHero>

      <SectionCard
        title='Request log'
        subtitle='Search, scope, and sort the current trace stream'
        action={
          <RequestControls
            query={query}
            procedure={procedure}
            procedures={procedures}
            status={status}
            latency={latency}
            filteredCount={filtered.length}
            filteredSummary={filteredSummary}
            activeFilters={activeFilters}
            hasActiveFilters={hasActiveFilters}
            onQueryChange={setQuery}
            onProcedureChange={setProcedure}
            onStatusChange={setStatus}
            onLatencyChange={setLatency}
            onClear={clearFilters}
          />
        }
        contentClassName='px-0 pb-0'
      >
        {filtered.length === 0 ? (
          <div className='px-6 py-10'>
            <EmptyState
              title='No matching requests'
              description={
                hasActiveFilters
                  ? 'Clear one or more filters to widen the current request stream.'
                  : 'Request snapshots appear here as soon as traffic is traced.'
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
                {(['time', 'procedure', 'status', 'spans', 'duration'] as const).map((key) => (
                  <TableHead
                    key={key}
                    onClick={() => handleSort(key)}
                    className={cn(
                      'cursor-pointer select-none px-4 text-xs',
                      (key === 'duration' || key === 'spans') && 'text-right',
                      sortKey === key && 'text-primary',
                    )}
                  >
                    {key === 'time'
                      ? 'Time'
                      : key === 'procedure'
                        ? 'Procedure'
                        : key === 'status'
                          ? 'Status'
                          : key === 'spans'
                            ? 'Spans'
                            : 'Duration'}
                    {sortKey === key && (sortAsc ? ' ↑' : ' ↓')}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow
                  key={entry.id}
                  onClick={() => navigate('requests', String(entry.id))}
                  className='cursor-pointer'
                >
                  <TableCell className='px-4 whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
                    {fmtTime(entry.timestamp)}
                  </TableCell>
                  <TableCell className='px-4 text-xs font-medium'>{entry.procedure}</TableCell>
                  <TableCell className='px-4'>
                    <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'} className='text-[10px]'>
                      {entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell className='px-4 text-right'>
                    <Badge variant='secondary' className='text-[10px]'>
                      {entry.spans.length}
                    </Badge>
                  </TableCell>
                  <TableCell className='px-4 text-right text-xs tabular-nums text-muted-foreground'>
                    {fmtMs(entry.durationMs)}
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

function RequestControls({
  query,
  procedure,
  procedures,
  status,
  latency,
  filteredCount,
  filteredSummary,
  activeFilters,
  hasActiveFilters,
  onQueryChange,
  onProcedureChange,
  onStatusChange,
  onLatencyChange,
  onClear,
}: {
  query: string
  procedure: string
  procedures: string[]
  status: RequestStatusFilter
  latency: RequestLatencyFilter
  filteredCount: number
  filteredSummary: ReturnType<typeof summarizeRequests>
  activeFilters: string[]
  hasActiveFilters: boolean
  onQueryChange: (value: string) => void
  onProcedureChange: (value: string) => void
  onStatusChange: (value: RequestStatusFilter) => void
  onLatencyChange: (value: RequestLatencyFilter) => void
  onClear: () => void
}) {
  return (
    <div className='flex w-full flex-col gap-3'>
      <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
        <div className='flex flex-1 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center'>
          <SearchField
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder='Search procedures...'
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
            value={status}
            onValueChange={(value) => onStatusChange((value as RequestStatusFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
            className='flex-wrap'
          >
            <ToggleGroupItem value='all'>All</ToggleGroupItem>
            <ToggleGroupItem value='success'>2xx</ToggleGroupItem>
            <ToggleGroupItem value='client'>4xx</ToggleGroupItem>
            <ToggleGroupItem value='server'>5xx</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            value={latency}
            onValueChange={(value) => onLatencyChange((value as RequestLatencyFilter) || 'all')}
            variant='outline'
            size='sm'
            spacing={1}
            className='flex-wrap'
          >
            <ToggleGroupItem value='all'>All latency</ToggleGroupItem>
            <ToggleGroupItem value='fast'>Fast</ToggleGroupItem>
            <ToggleGroupItem value='slow'>Slow</ToggleGroupItem>
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
        <Badge variant='secondary'>{fmtMs(filteredSummary.averageDuration)} avg</Badge>
        <Badge variant='secondary'>{filteredSummary.errorCount} errors</Badge>
        {activeFilters.map((item) => (
          <Badge key={item} variant='outline'>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function getRequestStatusLabel(filter: RequestStatusFilter) {
  switch (filter) {
    case 'success':
      return '2xx'
    case 'client':
      return '4xx'
    case 'server':
      return '5xx'
    default:
      return 'All'
  }
}

function getRequestLatencyLabel(filter: RequestLatencyFilter) {
  switch (filter) {
    case 'fast':
      return `Fast (<${SLOW_REQUEST_MS}ms)`
    case 'slow':
      return `Slow (>=${SLOW_REQUEST_MS}ms)`
    default:
      return 'All'
  }
}
