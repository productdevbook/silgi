import { useMemo } from 'react'

import type { ProcedureSnapshot } from '@/lib/types'

interface ErrorChartProps {
  procedures: Record<string, ProcedureSnapshot>
}

export function ErrorChart({ procedures }: ErrorChartProps) {
  const data = useMemo(() => {
    return Object.entries(procedures)
      .filter(([, p]) => p.errors > 0)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 6)
  }, [procedures])

  const maxErrors = useMemo(
    () => Math.max(1, ...data.map(([, p]) => p.errors)),
    [data],
  )

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        No errors
      </div>
    )
  }

  return (
    <div className="flex h-48 flex-col justify-center gap-2.5">
      {data.map(([path, proc]) => {
        const pct = (proc.errors / maxErrors) * 100
        const name = path.split('/').pop() || path
        return (
          <div key={path} className="flex items-center gap-3 text-xs">
            <span className="w-20 truncate text-right text-muted-foreground" title={path}>
              {name}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-destructive/70 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 tabular-nums font-medium">{proc.errors}</span>
          </div>
        )
      })}
    </div>
  )
}
