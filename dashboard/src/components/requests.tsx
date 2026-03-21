import { SearchField } from '@/components/dashboard-shell'
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
import { filterRequests, getProcedureOptions } from '@/lib/list-filters'
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
    let result = filterRequests(requests, { query, procedure, status, latency }).toReversed()
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

  const hasActiveFilters = query.length > 0 || procedure !== 'all' || status !== 'all' || latency !== 'all'

  const clearFilters = useCallback(() => {
    setQuery('')
    setProcedure('all')
    setStatus('all')
    setLatency('all')
  }, [])

  if (requests.length === 0) {
    return (
      <div className='flex min-h-60 flex-col items-center justify-center gap-1 text-center'>
        <p className='text-sm font-medium'>No traced requests yet</p>
        <p className='text-xs text-muted-foreground'>Requests appear once the collector sees traffic.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Filter bar */}
      <div className='flex flex-col gap-2 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-1 flex-wrap items-center gap-2'>
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            onValueChange={(value) => setStatus((value as RequestStatusFilter) || 'all')}
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
            onValueChange={(value) => setLatency((value as RequestLatencyFilter) || 'all')}
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
          <span className='text-[11px] tabular-nums text-muted-foreground'>{filtered.length} of {requests.length}</span>
          {hasActiveFilters && (
            <Button variant='ghost' size='xs' onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className='flex min-h-48 flex-col items-center justify-center gap-1 text-center'>
          <p className='text-sm font-medium'>No matching requests</p>
          <p className='text-xs text-muted-foreground'>
            {hasActiveFilters ? 'Adjust filters to widen the stream.' : 'Waiting for traffic.'}
          </p>
          {hasActiveFilters && (
            <Button variant='outline' size='xs' className='mt-2' onClick={clearFilters}>
              Clear filters
            </Button>
          )}
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
                    'cursor-pointer select-none px-3 py-2 text-[11px]',
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
                <TableCell className='px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
                  {fmtTime(entry.timestamp)}
                </TableCell>
                <TableCell className='px-3 py-2 text-xs font-medium'>{entry.procedure}</TableCell>
                <TableCell className='px-3 py-2'>
                  <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'} className='text-[10px]'>
                    {entry.status}
                  </Badge>
                </TableCell>
                <TableCell className='px-3 py-2 text-right'>
                  <Badge variant='secondary' className='text-[10px]'>
                    {entry.spans.length}
                  </Badge>
                </TableCell>
                <TableCell className='px-3 py-2 text-right text-xs tabular-nums text-muted-foreground'>
                  {fmtMs(entry.durationMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
