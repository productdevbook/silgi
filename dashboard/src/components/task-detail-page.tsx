import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/hooks'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { TaskExecution } from '@/lib/types'

interface TaskDetailPageProps {
  taskExecutions: TaskExecution[]
  id: string
  navigate: (page: string, id?: string) => void
}

export function TaskDetailPage({ taskExecutions, id, navigate }: TaskDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const entry = taskExecutions.find((t) => t.id === Number(id))

  if (!entry) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>
        Task execution not found
      </div>
    )
  }

  const jsonExport = JSON.stringify(entry, null, 2)

  return (
    <div className='flex min-h-full flex-col'>
      {/* Header */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('tasks')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Tasks
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='font-mono text-sm font-semibold'>{entry.taskName || '(unnamed)'}</span>
        <Badge variant={entry.status === 'success' ? 'default' : 'destructive'}>{entry.status}</Badge>
        <Badge variant='outline'>{entry.trigger}</Badge>
        <Badge variant='secondary'>{fmtMs(entry.durationMs)}</Badge>
        {entry.spans?.length > 0 && <Badge variant='secondary'>{entry.spans.length} spans</Badge>}
        <span className='text-[11px] text-muted-foreground'>{fmtTime(entry.timestamp)}</span>
        <span className='text-[11px] text-muted-foreground'>({fmtRelativeTime(entry.timestamp)})</span>
        <div className='ml-auto'>
          <Button
            variant={copiedId === 'json' ? 'default' : 'outline'}
            size='xs'
            onClick={() => copy('json', jsonExport)}
          >
            <HugeiconsIcon icon={copiedId === 'json' ? Tick01Icon : Copy01Icon} data-icon='inline-start' />
            {copiedId === 'json' ? 'copied' : 'json'}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className='grid flex-1 overflow-hidden xl:grid-cols-[1.2fr_0.8fr]'>
        {/* Left: data */}
        <div className='min-w-0 xl:border-r'>
          {/* Span timeline */}
          {entry.spans?.length > 0 && (
            <Section label={`Span timeline — ${entry.spans.length} spans, ${fmtMs(entry.durationMs)} total`}>
              <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
            </Section>
          )}

          {/* Input */}
          <Section label='Input'>
            {entry.input !== undefined && entry.input !== null ? (
              <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
                {JSON.stringify(entry.input, null, 2)}
              </pre>
            ) : (
              <p className='text-sm text-muted-foreground'>No input</p>
            )}
          </Section>

          {/* Output */}
          <Section label='Output'>
            {entry.output !== undefined && entry.output !== null ? (
              <pre className='max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
                {JSON.stringify(entry.output, null, 2)}
              </pre>
            ) : (
              <p className='text-sm text-muted-foreground'>No output</p>
            )}
          </Section>

          {/* Error */}
          {entry.error && (
            <Section label='Error'>
              <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-destructive/10 p-3 font-mono text-[11px] leading-relaxed text-destructive'>
                {entry.error}
              </pre>
            </Section>
          )}
        </div>

        {/* Right: metadata */}
        <div className='min-w-0'>
          <Section label='Execution'>
            <KV label='id' value={String(entry.id)} />
            <KV label='task' value={entry.taskName || '(unnamed)'} />
            <KV label='trigger' value={entry.trigger} />
            <KV label='status' value={entry.status} danger={entry.status === 'error'} />
            <KV label='duration' value={fmtMs(entry.durationMs)} />
            <KV label='time' value={fmtTime(entry.timestamp)} />
            <KV label='relative' value={fmtRelativeTime(entry.timestamp)} />
          </Section>

          {entry.input !== undefined && entry.input !== null && (
            <Section label='Input summary'>
              {typeof entry.input === 'object' ? (
                Object.entries(entry.input as Record<string, unknown>).map(([k, v]) => (
                  <KV key={k} label={k} value={typeof v === 'string' ? v : JSON.stringify(v)} />
                ))
              ) : (
                <KV label='value' value={String(entry.input)} />
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='border-b px-5 py-4 last:border-b-0'>
      <h4 className='mb-3 text-[11px] font-semibold text-muted-foreground'>{label}</h4>
      {children}
    </div>
  )
}

function KV({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='flex items-center justify-between border-b border-dashed py-1.5 last:border-0'>
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <span className={cn('max-w-[60%] truncate font-mono text-[11px]', danger && 'text-destructive')}>{value}</span>
    </div>
  )
}
