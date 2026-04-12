import { Badge } from '@/components/ui/badge'
import { fmt, fmtMs } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useCallback, useMemo, useState } from 'react'

import type { ProcedureSnapshot } from '@/lib/types'

type SortKey = 'path' | 'count' | 'errors' | 'errorRate' | 'avg' | 'p95'

function getSortValue(proc: ProcedureSnapshot, key: SortKey): number {
  if (key === 'count' || key === 'errors' || key === 'errorRate') return proc[key]
  if (key === 'path') return 0
  return proc.latency[key]
}

interface ProcedureTableProps {
  procedures: Record<string, ProcedureSnapshot>
  navigate?: (page: string, id?: string, params?: Record<string, string>) => void
  filter?: string
}

export function ProcedureTable({ procedures, navigate, filter }: ProcedureTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedSchema, setExpandedSchema] = useState<string | null>(null)

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortAsc((a) => !a)
      else setSortAsc(false)
      return key
    })
  }, [])

  const entries = useMemo(() => {
    let arr = Object.entries(procedures)
    if (filter) {
      const q = filter.toLowerCase()
      arr = arr.filter(([path]) => path.toLowerCase().includes(q))
    }
    const dir = sortAsc ? 1 : -1
    arr.sort((a, b) => {
      if (sortKey === 'path') return dir * a[0].localeCompare(b[0])
      return dir * (getSortValue(a[1], sortKey) - getSortValue(b[1], sortKey))
    })
    return arr
  }, [procedures, sortKey, sortAsc, filter])

  const maxCount = useMemo(() => Math.max(1, ...Object.values(procedures).map((p) => p.count)), [procedures])

  if (entries.length === 0) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>No requests yet</div>
    )
  }

  return (
    <div>
      {/* Header row */}
      <div className='flex items-center gap-2 border-b px-5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground'>
        <SortCol
          label='Procedure'
          sortKey='path'
          currentKey={sortKey}
          asc={sortAsc}
          onSort={handleSort}
          className='flex-1'
        />
        <SortCol
          label='Count'
          sortKey='count'
          currentKey={sortKey}
          asc={sortAsc}
          onSort={handleSort}
          className='w-20 text-right'
        />
        <span className='hidden w-20 lg:block' />
        <SortCol
          label='Errors'
          sortKey='errors'
          currentKey={sortKey}
          asc={sortAsc}
          onSort={handleSort}
          className='w-14 text-right'
        />
        <SortCol
          label='Rate'
          sortKey='errorRate'
          currentKey={sortKey}
          asc={sortAsc}
          onSort={handleSort}
          className='w-12 text-right'
        />
        <SortCol
          label='Avg'
          sortKey='avg'
          currentKey={sortKey}
          asc={sortAsc}
          onSort={handleSort}
          className='w-14 text-right'
        />
        <SortCol
          label='p95'
          sortKey='p95'
          currentKey={sortKey}
          asc={sortAsc}
          onSort={handleSort}
          className='w-14 text-right'
        />
      </div>

      {/* Rows */}
      {entries.map(([path, proc]) => {
        const countPct = (proc.count / maxCount) * 100
        const hasErrors = proc.errors > 0
        const hasSchema = !!(proc.inputSchema || proc.outputSchema)
        const isExpanded = expandedSchema === path

        return (
          <div key={path}>
            <div
              className={cn(
                'flex items-center gap-2 border-b border-dashed px-5 py-2 hover:bg-muted/20',
                navigate && 'cursor-pointer',
              )}
              onClick={() => navigate?.('requests', undefined, { procedure: path })}
            >
              {/* Procedure name */}
              <span className='min-w-0 flex-1 truncate font-mono text-[11px] font-semibold'>
                {path}
                {hasSchema && (
                  <button
                    className='ml-2 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedSchema(isExpanded ? null : path)
                    }}
                  >
                    {isExpanded ? 'Hide schema' : 'Schema'}
                  </button>
                )}
              </span>

              {/* Count */}
              <span className='w-20 shrink-0 text-right font-mono text-[11px] tabular-nums'>{fmt(proc.count)}</span>

              {/* Count bar */}
              <div className='hidden w-20 lg:block'>
                <div className='h-1.5 w-full rounded-full bg-muted'>
                  <div className='h-full rounded-full bg-primary/30' style={{ width: `${countPct}%` }} />
                </div>
              </div>

              {/* Errors */}
              <div className='w-14 shrink-0 text-right'>
                {hasErrors ? (
                  <Badge
                    variant='destructive'
                    className='text-[9px]'
                    onClick={(e) => {
                      if (navigate) {
                        e.stopPropagation()
                        navigate('errors', undefined, { procedure: path })
                      }
                    }}
                  >
                    {proc.errors}
                  </Badge>
                ) : (
                  <span className='text-[11px] text-muted-foreground/40'>0</span>
                )}
              </div>

              {/* Error rate */}
              <span
                className={cn(
                  'w-12 shrink-0 text-right text-[11px] tabular-nums',
                  hasErrors ? 'text-destructive' : 'text-muted-foreground/40',
                )}
              >
                {proc.errorRate.toFixed(1)}%
              </span>

              {/* Avg */}
              <span className='w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground'>
                {fmtMs(proc.latency.avg)}
              </span>

              {/* p95 */}
              <span className='w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground'>
                {fmtMs(proc.latency.p95)}
              </span>
            </div>

            {/* Schema detail */}
            {isExpanded && hasSchema && (
              <div className='border-b bg-muted/10 px-5 py-3'>
                <div className='flex gap-6'>
                  {proc.inputSchema && (
                    <div className='flex-1'>
                      <span className='mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
                        Input
                      </span>
                      <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
                        {JSON.stringify(proc.inputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                  {proc.outputSchema && (
                    <div className='flex-1'>
                      <span className='mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
                        Output
                      </span>
                      <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
                        {JSON.stringify(proc.outputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Shared ──

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
