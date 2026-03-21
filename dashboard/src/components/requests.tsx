import { useCallback, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtMs, fmtTime } from '@/lib/format'

import type { RequestEntry } from '@/lib/types'

type SortKey = 'time' | 'procedure' | 'duration' | 'spans'

interface RequestsProps {
  requests: RequestEntry[]
  navigate: (page: string, id?: string) => void
}

export function Requests({ requests, navigate }: RequestsProps) {
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(key === 'procedure')
      return key
    })
  }, [])

  const filtered = useMemo(() => {
    let result = [...requests].reverse()
    if (filter) {
      const q = filter.toLowerCase()
      result = result.filter((r) => r.procedure.toLowerCase().includes(q))
    }
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      switch (sortKey) {
        case 'time': return dir * (a.timestamp - b.timestamp)
        case 'procedure': return dir * a.procedure.localeCompare(b.procedure)
        case 'duration': return dir * (a.durationMs - b.durationMs)
        case 'spans': return dir * (a.spans.length - b.spans.length)
      }
    })
    return result
  }, [requests, filter, sortKey, sortAsc])

  if (requests.length === 0) {
    return <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">No traced requests yet</div>
  }

  return (
    <div className="space-y-4 p-6">
      <div className="relative">
        <HugeiconsIcon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by procedure..."
          className="h-8 w-full rounded-md border bg-transparent pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {(['time', 'procedure', 'spans', 'duration'] as const).map((key) => (
                <TableHead
                  key={key}
                  onClick={() => handleSort(key)}
                  className={`cursor-pointer select-none text-xs ${key === 'duration' || key === 'spans' ? 'text-right' : ''} ${sortKey === key ? 'text-primary' : ''}`}
                >
                  {key === 'time' ? 'Time' : key === 'procedure' ? 'Procedure' : key === 'spans' ? 'Spans' : 'Duration'}
                  {sortKey === key && (sortAsc ? ' ↑' : ' ↓')}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((entry) => (
              <TableRow key={entry.id} onClick={() => navigate('requests', String(entry.id))} className="cursor-pointer">
                <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmtTime(entry.timestamp)}</TableCell>
                <TableCell className="text-xs font-medium">{entry.procedure}</TableCell>
                <TableCell className="text-right"><Badge variant="secondary" className="text-[10px]">{entry.spans.length}</Badge></TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{fmtMs(entry.durationMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
