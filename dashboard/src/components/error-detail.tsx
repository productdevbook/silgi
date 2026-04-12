import { SpanWaterfall } from '@/components/span-waterfall'
import { fmtMs } from '@/lib/format'
import { isSensitiveHeader, shouldRedactSensitiveData } from '@/lib/privacy'
import { cn } from '@/lib/utils'

import type { ErrorEntry } from '@/lib/types'

interface ErrorDetailProps {
  entry: ErrorEntry
}

export function ErrorDetail({ entry }: ErrorDetailProps) {
  const headerEntries = Object.entries(entry.headers ?? {})
  const hasInput = entry.input !== undefined && entry.input !== null
  const hasSpans = entry.spans.length > 0
  const hasHeaders = headerEntries.length > 0
  const shouldRedact = shouldRedactSensitiveData()

  return (
    <div className='grid xl:grid-cols-[1.6fr_1fr]'>
      {/* Left column */}
      <div className='xl:border-r'>
        <Section label='Error message'>
          <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-destructive/90'>
            {entry.error}
          </pre>
        </Section>

        {hasSpans && (
          <Section label={`Trace timeline — ${entry.spans.length} ops, ${fmtMs(entry.durationMs)} total`}>
            <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
          </Section>
        )}

        {entry.stack && (
          <Section label='Stack trace'>
            <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground'>
              {entry.stack}
            </pre>
          </Section>
        )}
      </div>

      {/* Right column */}
      <div>
        <Section label='Metadata'>
          <div className='flex flex-col'>
            <KV label='id' value={String(entry.id)} />
            <KV label='status' value={String(entry.status)} danger={entry.status >= 500} />
            <KV label='code' value={entry.code} danger />
            <KV label='duration' value={fmtMs(entry.durationMs)} />
            <KV label='spans' value={String(entry.spans.length)} />
            <KV label='headers' value={String(headerEntries.length)} />
          </div>
        </Section>

        {hasInput && (
          <Section label='Input payload'>
            <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed'>
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </Section>
        )}

        {hasHeaders && (
          <Section label='Headers'>
            <div className='flex flex-col'>
              {headerEntries.map(([key, value]) => (
                <div key={key} className='flex gap-3 border-b border-dashed py-1.5 last:border-0'>
                  <span className='w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground'>{key}</span>
                  <span className='min-w-0 break-all font-mono text-[11px]'>
                    {shouldRedact && isSensitiveHeader(key) ? (
                      <span className='text-muted-foreground/40'>[redacted]</span>
                    ) : (
                      value
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
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
      <span className={cn('font-mono text-[11px]', danger && 'text-destructive')}>{value}</span>
    </div>
  )
}
