import { Badge } from '@/components/ui/badge'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'

import type { AnalyticsData, ScheduledTaskInfo, TaskExecution } from '@/lib/types'

interface TasksProps {
  data: AnalyticsData | null
  taskExecutions: TaskExecution[]
  scheduledTasks: ScheduledTaskInfo[]
  navigate: (page: string, id?: string) => void
}

export function Tasks({ data, taskExecutions, scheduledTasks, navigate }: TasksProps) {
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all')

  const taskStats = data?.tasks
  const statEntries = useMemo(
    () => Object.entries(taskStats?.tasks ?? {}).sort((a, b) => b[1].runs - a[1].runs),
    [taskStats],
  )

  const filtered = useMemo(() => {
    const list = [...taskExecutions].toReversed()
    if (filter === 'all') return list
    return list.filter((t) => t.status === filter)
  }, [taskExecutions, filter])

  return (
    <div className='flex flex-col gap-6 p-4 md:p-6'>
      {/* Stats cards */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <StatCard label='Total runs' value={taskStats?.totalRuns ?? 0} />
        <StatCard label='Errors' value={taskStats?.totalErrors ?? 0} danger={!!taskStats?.totalErrors} />
        <StatCard label='Task types' value={statEntries.length} />
        <StatCard label='Scheduled' value={scheduledTasks.length} />
      </div>

      {/* Scheduled tasks */}
      {scheduledTasks.length > 0 && (
        <div>
          <h3 className='mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground'>Scheduled (cron)</h3>
          <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
            {scheduledTasks.map((s) => (
              <div key={s.name + s.cron} className='rounded-lg border bg-card p-3'>
                <div className='flex items-center justify-between'>
                  <span className='font-mono text-xs font-medium'>{s.name}</span>
                  <Badge variant='outline' className='text-[10px] font-mono'>
                    {s.cron}
                  </Badge>
                </div>
                {s.description && <p className='mt-1 text-[11px] text-muted-foreground'>{s.description}</p>}
                <div className='mt-2 flex gap-4 text-[11px] text-muted-foreground'>
                  <span>
                    Runs: <span className='font-mono text-foreground'>{s.runs}</span>
                  </span>
                  <span className={cn(s.errors > 0 && 'text-destructive')}>
                    Errors: <span className='font-mono'>{s.errors}</span>
                  </span>
                </div>
                <div className='mt-1 flex gap-4 text-[11px] text-muted-foreground'>
                  <span>
                    Last:{' '}
                    <span className='font-mono text-foreground'>{s.lastRun ? fmtRelativeTime(s.lastRun) : '—'}</span>
                  </span>
                  <span>
                    Next:{' '}
                    <span className='font-mono text-foreground'>
                      {s.nextRun ? fmtRelativeTime(s.nextRun).replace(' ago', '') : '—'}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-task breakdown */}
      {statEntries.length > 0 && (
        <div>
          <h3 className='mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground'>Tasks</h3>
          <div className='overflow-hidden rounded-lg border'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b bg-muted/40 text-left text-xs text-muted-foreground'>
                  <th className='px-3 py-2 font-medium'>Name</th>
                  <th className='px-3 py-2 font-medium text-right'>Runs</th>
                  <th className='px-3 py-2 font-medium text-right'>Errors</th>
                  <th className='px-3 py-2 font-medium text-right'>Avg</th>
                  <th className='px-3 py-2 font-medium text-right'>Last run</th>
                </tr>
              </thead>
              <tbody>
                {statEntries.map(([name, stats]) => (
                  <tr key={name} className='border-b last:border-0 hover:bg-muted/20'>
                    <td className='px-3 py-2 font-mono text-xs'>{name}</td>
                    <td className='px-3 py-2 text-right font-mono tabular-nums'>{stats.runs}</td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono tabular-nums',
                        stats.errors > 0 && 'text-destructive font-medium',
                      )}
                    >
                      {stats.errors}
                    </td>
                    <td className='px-3 py-2 text-right font-mono tabular-nums text-muted-foreground'>
                      {fmtMs(stats.avgDurationMs)}
                    </td>
                    <td className='px-3 py-2 text-right text-muted-foreground'>
                      {stats.lastRun ? fmtRelativeTime(stats.lastRun) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Execution history */}
      <div>
        <div className='mb-2 flex items-center justify-between'>
          <h3 className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>Execution history</h3>
          <div className='flex gap-1'>
            {(['all', 'success', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                  filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {f === 'all' ? 'All' : f === 'success' ? 'Success' : 'Errors'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className='flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground'>
            No task executions yet
          </div>
        ) : (
          <div className='overflow-hidden rounded-lg border'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b bg-muted/40 text-left text-xs text-muted-foreground'>
                  <th className='px-3 py-2 font-medium'>Task</th>
                  <th className='px-3 py-2 font-medium'>Trigger</th>
                  <th className='px-3 py-2 font-medium'>Status</th>
                  <th className='px-3 py-2 font-medium text-right'>Spans</th>
                  <th className='px-3 py-2 font-medium text-right'>Duration</th>
                  <th className='px-3 py-2 font-medium text-right'>Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate('tasks', String(t.id))}
                    className='cursor-pointer border-b last:border-0 hover:bg-muted/20 transition-colors'
                  >
                    <td className='px-3 py-2 font-mono text-xs'>{t.taskName || '(unnamed)'}</td>
                    <td className='px-3 py-2'>
                      <Badge variant='outline' className='text-[10px] font-normal'>
                        {t.trigger}
                      </Badge>
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant={t.status === 'success' ? 'default' : 'destructive'} className='text-[10px]'>
                        {t.status}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-right font-mono tabular-nums text-muted-foreground'>
                      {t.spans?.length || 0}
                    </td>
                    <td className='px-3 py-2 text-right font-mono tabular-nums text-muted-foreground'>
                      {fmtMs(t.durationMs)}
                    </td>
                    <td className='px-3 py-2 text-right text-muted-foreground text-xs'>{fmtTime(t.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className='rounded-lg border bg-card p-3'>
      <p className='text-[11px] font-medium text-muted-foreground'>{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', danger && 'text-destructive')}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}
