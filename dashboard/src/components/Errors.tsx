import { useCallback, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtMs, fmtTime } from '@/lib/format'

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
    case 'time': return entry.timestamp
    case 'procedure': return entry.procedure
    case 'code': return entry.code
    case 'status': return entry.status
    case 'duration': return entry.durationMs
  }
}

interface ErrorsProps {
  errors: ErrorEntry[]
  navigate: (page: string, id?: string) => void
}

export function Errors({ errors, navigate }: ErrorsProps) {
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(key === 'procedure' || key === 'code')
      return key
    })
  }, [])

  const filtered = useMemo(() => {
    let result = [...errors].reverse()
    if (filter) {
      const q = filter.toLowerCase()
      result = result.filter(
        (e) =>
          e.procedure.toLowerCase().includes(q) ||
          e.code.toLowerCase().includes(q) ||
          e.error.toLowerCase().includes(q),
      )
    }
    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb)
      return dir * String(va).localeCompare(String(vb))
    })
    return result
  }, [errors, filter, sortKey, sortAsc])

  if (errors.length === 0) {
    return <Empty>No errors recorded</Empty>
  }

  return (
    <div className="space-y-4 p-6">
      <FilterInput value={filter} onChange={setFilter} placeholder="Filter errors..." />

      {filtered.length === 0 ? (
        <Empty>No errors match &ldquo;{filter}&rdquo;</Empty>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((col) => (
                  <SortHead key={col.key} col={col} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                ))}
                <TableHead className="text-xs">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow key={entry.id} onClick={() => navigate('errors', String(entry.id))} className="cursor-pointer">
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmtTime(entry.timestamp)}</TableCell>
                  <TableCell className="text-xs font-medium">{entry.procedure}</TableCell>
                  <TableCell><Badge variant="destructive" className="text-[10px]">{entry.code}</Badge></TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{entry.status}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{fmtMs(entry.durationMs)}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">{entry.error}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <HugeiconsIcon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border bg-transparent pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
      />
    </div>
  )
}

function SortHead({ col, sortKey, sortAsc, onSort }: { col: { key: SortKey; label: string; align: string }; sortKey: string; sortAsc: boolean; onSort: (k: SortKey) => void }) {
  return (
    <TableHead
      onClick={() => onSort(col.key)}
      className={`cursor-pointer select-none text-xs ${col.align === 'right' ? 'text-right' : ''} ${sortKey === col.key ? 'text-primary' : ''}`}
    >
      {col.label}{sortKey === col.key && (sortAsc ? ' ↑' : ' ↓')}
    </TableHead>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">{children}</div>
}
