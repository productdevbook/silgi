import { SearchField } from '@/components/dashboard-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useCallback, useMemo, useState } from 'react'

import type { RequestEntry } from '@/lib/types'

interface SessionSummary {
  sessionId: string
  requestCount: number
  errorCount: number
  totalMs: number
  avgMs: number
  firstTimestamp: number
  lastTimestamp: number
  procedures: string[]
  ip: string
  userAgent: string
  userName?: string
}

type SortKey = 'time' | 'requests' | 'errors' | 'duration' | 'avg'

interface SessionsProps {
  requests: RequestEntry[]
  navigate: (page: string, id?: string) => void
}

export function Sessions({ requests, navigate }: SessionsProps) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(false)
      return key
    })
  }, [])

  const sessions = useMemo(() => {
    const bySession = new Map<string, RequestEntry[]>()
    for (const r of requests) {
      if (!r.sessionId) continue
      const arr = bySession.get(r.sessionId)
      if (arr) arr.push(r)
      else bySession.set(r.sessionId, [r])
    }

    let result: SessionSummary[] = []
    for (const [sessionId, reqs] of bySession) {
      const sorted = reqs.sort((a, b) => a.timestamp - b.timestamp)
      const totalMs = reqs.reduce((sum, r) => sum + r.durationMs, 0)
      const errorCount = reqs.filter((r) => r.status >= 400).length
      const procedures = [...new Set(reqs.flatMap((r) => r.procedures.map((p) => p.procedure)))]
      result.push({
        sessionId,
        requestCount: reqs.length,
        errorCount,
        totalMs,
        avgMs: totalMs / reqs.length,
        firstTimestamp: sorted[0]!.timestamp,
        lastTimestamp: sorted[sorted.length - 1]!.timestamp,
        procedures,
        ip: sorted[sorted.length - 1]!.ip,
        userAgent: sorted[sorted.length - 1]!.userAgent,
        userName: reqs.find((r) => r.user)?.user?.name || reqs.find((r) => r.user)?.user?.email || (reqs.find((r) => r.user)?.user?.id ? String(reqs.find((r) => r.user)?.user?.id) : undefined),
      })
    }

    // Filter
    if (query) {
      const q = query.toLowerCase()
      result = result.filter(
        (s) =>
          s.sessionId.toLowerCase().includes(q) ||
          s.procedures.some((p) => p.toLowerCase().includes(q)) ||
          s.ip.includes(q) ||
          s.userName?.toLowerCase().includes(q),
      )
    }

    // Sort
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      switch (sortKey) {
        case 'time':
          return dir * (a.lastTimestamp - b.lastTimestamp)
        case 'requests':
          return dir * (a.requestCount - b.requestCount)
        case 'errors':
          return dir * (a.errorCount - b.errorCount)
        case 'duration':
          return dir * (a.totalMs - b.totalMs)
        case 'avg':
          return dir * (a.avgMs - b.avgMs)
      }
    })

    return result
  }, [requests, query, sortKey, sortAsc])

  const totalSessions = useMemo(() => {
    const ids = new Set<string>()
    for (const r of requests) {
      if (r.sessionId) ids.add(r.sessionId)
    }
    return ids.size
  }, [requests])

  if (requests.length === 0) {
    return (
      <div className='flex min-h-60 flex-col items-center justify-center gap-1 text-center'>
        <p className='text-sm font-semibold'>No sessions yet</p>
        <p className='text-xs text-muted-foreground'>Sessions appear when requests with session IDs are captured.</p>
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
            placeholder='Search sessions...'
            className='sm:max-w-56'
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-[11px] tabular-nums text-muted-foreground'>
            {sessions.length} of {totalSessions} sessions
          </span>
          {query && (
            <Button variant='ghost' size='xs' onClick={() => setQuery('')}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {sessions.length === 0 ? (
        <div className='flex min-h-48 flex-col items-center justify-center gap-1 text-center'>
          <p className='text-sm font-semibold'>No matching sessions</p>
          <p className='text-xs text-muted-foreground'>Adjust your search to find sessions.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='px-3 py-2 text-[11px]'>Session</TableHead>
              <TableHead className='px-3 py-2 text-[11px]'>User</TableHead>
              {([
                ['time', 'Last seen'],
                ['requests', 'Requests'],
                ['errors', 'Errors'],
                ['duration', 'Total'],
                ['avg', 'Avg'],
              ] as const).map(([key, label]) => (
                <TableHead
                  key={key}
                  onClick={() => handleSort(key)}
                  className={cn(
                    'cursor-pointer select-none px-3 py-2 text-[11px]',
                    (key === 'requests' || key === 'errors' || key === 'duration' || key === 'avg') && 'text-right',
                    sortKey === key && 'text-primary',
                  )}
                >
                  {label}
                  {sortKey === key && (sortAsc ? ' ↑' : ' ↓')}
                </TableHead>
              ))}
              <TableHead className='px-3 py-2 text-[11px]'>Procedures</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow
                key={session.sessionId}
                onClick={() => navigate('sessions', session.sessionId)}
                className='cursor-pointer'
              >
                <TableCell className='px-3 py-2'>
                  <Badge variant='secondary' className='font-mono text-[10px]'>
                    {session.sessionId.slice(0, 12)}
                  </Badge>
                </TableCell>
                <TableCell className='px-3 py-2 text-xs text-muted-foreground'>
                  {session.userName || <span className='text-muted-foreground/40'>—</span>}
                </TableCell>
                <TableCell className='px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
                  <Tooltip>
                    <TooltipTrigger className='cursor-default'>{fmtRelativeTime(session.lastTimestamp)}</TooltipTrigger>
                    <TooltipContent side='right' className='text-xs'>
                      {fmtTime(session.lastTimestamp)}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className='px-3 py-2 text-right text-xs tabular-nums'>{session.requestCount}</TableCell>
                <TableCell className='px-3 py-2 text-right'>
                  {session.errorCount > 0 ? (
                    <Badge variant='destructive' className='text-[10px]'>{session.errorCount}</Badge>
                  ) : (
                    <span className='text-xs text-muted-foreground'>0</span>
                  )}
                </TableCell>
                <TableCell className='px-3 py-2 text-right text-xs tabular-nums text-muted-foreground'>
                  {fmtMs(session.totalMs)}
                </TableCell>
                <TableCell className='px-3 py-2 text-right text-xs tabular-nums text-muted-foreground'>
                  {fmtMs(session.avgMs)}
                </TableCell>
                <TableCell className='max-w-[240px] px-3 py-2 truncate text-xs text-muted-foreground'>
                  {session.procedures.join(', ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
