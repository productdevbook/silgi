import { useCallback, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmt, fmtMs } from '@/lib/format'

import type { ProcedureSnapshot } from '@/lib/types'

type SortKey = 'path' | 'count' | 'errors' | 'avg' | 'p50' | 'p95' | 'p99'

const COLUMNS: readonly { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'path', label: 'Procedure', align: 'left' },
  { key: 'count', label: 'Count', align: 'right' },
  { key: 'errors', label: 'Errors', align: 'right' },
  { key: 'avg', label: 'Avg', align: 'right' },
  { key: 'p50', label: 'p50', align: 'right' },
  { key: 'p95', label: 'p95', align: 'right' },
  { key: 'p99', label: 'p99', align: 'right' },
] as const

function getSortValue(proc: ProcedureSnapshot, key: SortKey): number {
  if (key === 'count' || key === 'errors') return proc[key]
  if (key === 'path') return 0
  return proc.latency[key]
}

interface ProcedureTableProps {
  procedures: Record<string, ProcedureSnapshot>
}

export function ProcedureTable({ procedures }: ProcedureTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a)
      } else {
        setSortAsc(false)
      }
      return key
    })
  }, [])

  const entries = useMemo(() => {
    const arr = Object.entries(procedures)
    const dir = sortAsc ? 1 : -1
    arr.sort((a, b) => {
      if (sortKey === 'path') return dir * a[0].localeCompare(b[0])
      return dir * (getSortValue(a[1], sortKey) - getSortValue(b[1], sortKey))
    })
    return arr
  }, [procedures, sortKey, sortAsc])

  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(procedures).map((p) => p.count)),
    [procedures],
  )

  if (entries.length === 0) {
    return (
      <Card>
        <div className="py-10 text-center text-sm text-muted-foreground">No requests yet</div>
      </Card>
    )
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`cursor-pointer select-none ${
                  col.align === 'right' ? 'text-right' : ''
                } ${sortKey === col.key ? 'text-primary' : ''}`}
              >
                {col.label}
                {sortKey === col.key && (sortAsc ? ' \u2191' : ' \u2193')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([path, proc]) => (
            <ProcedureRow key={path} path={path} proc={proc} maxCount={maxCount} />
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function ProcedureRow({
  path,
  proc,
  maxCount,
}: {
  path: string
  proc: ProcedureSnapshot
  maxCount: number
}) {
  const percentage = (proc.count / maxCount) * 100

  return (
    <Tooltip>
      <TooltipTrigger render={<TableRow className="cursor-default" />}>
          <TableCell className="font-medium text-primary">
            {path.replace(/\//g, ' / ')}
          </TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-2">
              <Progress value={percentage} className="h-1.5 w-16" />
              <span className="tabular-nums">{fmt(proc.count)}</span>
            </div>
          </TableCell>
          <TableCell className="text-right">
            {proc.errors > 0 ? (
              <Badge variant="destructive">{proc.errors}</Badge>
            ) : (
              <span className="text-muted-foreground">0</span>
            )}
          </TableCell>
          <TableCell className="text-right tabular-nums">{fmtMs(proc.latency.avg)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtMs(proc.latency.p50)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtMs(proc.latency.p95)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtMs(proc.latency.p99)}</TableCell>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="font-medium">{path}</span> — error rate {proc.errorRate.toFixed(1)}%
      </TooltipContent>
    </Tooltip>
  )
}
