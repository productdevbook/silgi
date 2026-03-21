import { CodePanel, SectionCard } from '@/components/dashboard-shell'
import { SpanWaterfall } from '@/components/span-waterfall'
import { fmtMs } from '@/lib/format'

import type { ErrorEntry } from '@/lib/types'

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-api-key'])

interface ErrorDetailProps {
  entry: ErrorEntry
}

export function ErrorDetail({ entry }: ErrorDetailProps) {
  const headerEntries = Object.entries(entry.headers ?? {})
  const hasInput = entry.input !== undefined && entry.input !== null
  const hasSpans = entry.spans.length > 0
  const hasHeaders = headerEntries.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <SectionCard title="Error" subtitle="The thrown message captured by analytics">
          <CodePanel>{entry.error}</CodePanel>
        </SectionCard>

        {hasSpans && (
          <SectionCard title="Trace" subtitle={`${entry.spans.length} operations across ${fmtMs(entry.durationMs)} total`}>
            <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
          </SectionCard>
        )}
      </div>

      {(hasInput || hasHeaders) && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          {hasInput && (
            <SectionCard title="Input" subtitle="The request payload that led to the failure">
              <CodePanel>{JSON.stringify(entry.input, null, 2)}</CodePanel>
            </SectionCard>
          )}

          {hasHeaders && (
            <SectionCard title="Headers" subtitle="Sensitive headers are redacted before display">
              <div className="flex flex-col gap-0">
                {headerEntries.map(([key, value]) => (
                  <div key={key} className="flex gap-3 border-b border-dashed py-1.5 last:border-0">
                    <span className="w-36 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{key}</span>
                    <span className="min-w-0 break-all font-mono text-[11px]">
                      {SENSITIVE_HEADERS.has(key.toLowerCase()) ? (
                        <span className="text-muted-foreground/50">[redacted]</span>
                      ) : value}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {entry.stack && (
        <SectionCard title="Stack trace" subtitle="Useful for mapping the failure back to its source">
          <CodePanel>{entry.stack}</CodePanel>
        </SectionCard>
      )}
    </div>
  )
}
