import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SpanWaterfall } from '@/components/span-waterfall'
import { fmtMs, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { RequestEntry } from '@/lib/types'

interface RequestDetailPageProps {
  requests: RequestEntry[]
  id: string
  navigate: (page: string) => void
}

export function RequestDetailPage({ requests, id, navigate }: RequestDetailPageProps) {
  const entry = requests.find((r) => r.id === Number(id))

  if (!entry) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>Request not found</div>
    )
  }

  const hasInput = entry.input !== undefined && entry.input !== null

  return (
    <div>
      {/* Header bar */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('requests')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Requests
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='font-mono text-sm font-medium'>{entry.procedure}</span>
        <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'}>{entry.status}</Badge>
        <Badge variant='secondary'>{fmtMs(entry.durationMs)}</Badge>
        {entry.spans.length > 0 && <Badge variant='secondary'>{entry.spans.length} spans</Badge>}
        <span className='text-[11px] text-muted-foreground'>{fmtTime(entry.timestamp)}</span>
      </div>

      {/* Detail content */}
      <div className='grid xl:grid-cols-[1.65fr_0.9fr]'>
        <div className='xl:border-r'>
          <Section label={`Span timeline — ${entry.spans.length} ops, ${fmtMs(entry.durationMs)} total`}>
            {entry.spans.length > 0 ? (
              <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
            ) : (
              <p className='text-sm text-muted-foreground'>No internal spans were recorded for this trace.</p>
            )}
          </Section>
        </div>

        <div>
          <Section label='Metadata'>
            <div className='flex flex-col'>
              <KV label='id' value={String(entry.id)} />
              <KV label='status' value={String(entry.status)} danger={entry.status >= 400} />
              <KV label='spans' value={String(entry.spans.length)} />
              <KV label='duration' value={fmtMs(entry.durationMs)} />
              <KV label='input' value={hasInput ? 'captured' : 'empty'} />
            </div>
          </Section>

          {hasInput && (
            <Section label='Input payload'>
              <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed'>
                {JSON.stringify(entry.input, null, 2)}
              </pre>
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
      <h4 className='mb-3 text-[11px] font-medium text-muted-foreground'>{label}</h4>
      {children}
    </div>
  )
}

function KV({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='flex items-center justify-between border-b border-dashed py-1.5 last:border-0'>
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <span className={cn('font-mono text-[11px]', danger && 'text-destructive')}>{value}</span>
    </div>
  )
}
