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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { filterErrors, getProcedureOptions } from '@/lib/list-filters'
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
  initialProcedure?: string
}

export function Errors({ errors, navigate, initialProcedure }: ErrorsProps) {
  const [query, setQuery] = useState('')
  const [procedure, setProcedure] = useState(initialProcedure || 'all')
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

  if (errors.length === 0) {
    return (
      <div className='flex min-h-60 flex-col items-center justify-center gap-1 text-center'>
        <p className='text-sm font-medium'>No errors recorded</p>
        <p className='text-xs text-muted-foreground'>Failures will appear here when captured.</p>
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
            onValueChange={(value) => setSeverity((value as ErrorSeverityFilter) || 'all')}
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
            onValueChange={(value) => setTrace((value as ErrorTraceFilter) || 'all')}
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

      {/* Table */}
      {filtered.length === 0 ? (
        <div className='flex min-h-48 flex-col items-center justify-center gap-1 text-center'>
          <p className='text-sm font-medium'>No matching failures</p>
          <p className='text-xs text-muted-foreground'>
            {hasActiveFilters ? 'Adjust filters to widen the stream.' : 'Waiting for errors.'}
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
              {COLUMNS.map((col) => (
                <SortHead key={col.key} col={col} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              ))}
              <TableHead className='text-xs'>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((entry) => (
              <TableRow key={entry.id} onClick={() => navigate('errors', String(entry.id))} className='cursor-pointer'>
                <TableCell className='px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
                  <Tooltip>
                    <TooltipTrigger className='cursor-default'>{fmtRelativeTime(entry.timestamp)}</TooltipTrigger>
                    <TooltipContent side='right' className='text-xs'>
                      {fmtTime(entry.timestamp)}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className='px-3 py-2 text-xs font-medium'>{entry.procedure}</TableCell>
                <TableCell className='px-3 py-2'>
                  <Badge variant='destructive' className='text-[10px]'>
                    {entry.code}
                  </Badge>
                </TableCell>
                <TableCell className='px-3 py-2 text-right text-xs tabular-nums text-muted-foreground'>
                  {entry.status}
                </TableCell>
                <TableCell className='px-3 py-2 text-right text-xs tabular-nums text-muted-foreground'>
                  {fmtMs(entry.durationMs)}
                </TableCell>
                <TableCell className='max-w-[320px] px-3 py-2 truncate text-xs text-muted-foreground'>
                  {entry.error}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
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
        'cursor-pointer select-none px-3 py-2 text-[11px]',
        col.align === 'right' && 'text-right',
        sortKey === col.key && 'text-primary',
      )}
    >
      {col.label}
      {sortKey === col.key && (sortAsc ? ' ↑' : ' ↓')}
    </TableHead>
  )
}
