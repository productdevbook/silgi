import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { fmtMs } from '@/lib/format'
import { useMemo } from 'react'

import type { ProcedureSnapshot } from '@/lib/types'

interface ErrorChartProps {
  procedures: Record<string, ProcedureSnapshot>
}

export function ErrorChart({ procedures }: ErrorChartProps) {
  const data = useMemo(() => {
    return Object.entries(procedures)
      .filter(([, p]) => p.errors > 0)
      .toSorted((a, b) => b[1].errors - a[1].errors)
      .slice(0, 5)
  }, [procedures])

  if (data.length === 0) {
    return <div className='flex h-48 items-center justify-center text-xs text-muted-foreground'>No errors</div>
  }

  return (
    <div className='flex flex-col gap-3'>
      {data.map(([path, proc]) => {
        return (
          <Card key={path} size='sm' className='bg-muted/20 shadow-none'>
            <CardContent>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium tracking-tight' title={path}>
                    {path}
                  </p>
                  <p className='mt-1 truncate text-xs text-muted-foreground'>
                    {proc.lastError ?? 'Latest failure message unavailable'}
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  <Badge variant='destructive'>{proc.errors}</Badge>
                  <Badge variant='outline'>{proc.errorRate.toFixed(1)}%</Badge>
                </div>
              </div>
              <div className='mt-3 flex items-center justify-between text-xs text-muted-foreground'>
                <span>p95 {fmtMs(proc.latency.p95)}</span>
                <span>{formatLastErrorTime(proc.lastErrorTime)}</span>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function formatLastErrorTime(timestamp: number | null) {
  if (!timestamp) return 'No recent timestamp'
  return new Date(timestamp).toLocaleTimeString()
}
