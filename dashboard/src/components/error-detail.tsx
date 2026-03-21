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
    <div className="space-y-8">
      <Section title="Error">
        <CodeBlock>{entry.error}</CodeBlock>
      </Section>

      {hasSpans && (
        <Section title="Trace" subtitle={`${entry.spans.length} operations · ${fmtMs(entry.durationMs)} total`}>
          <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
        </Section>
      )}

      {hasInput && (
        <Section title="Input">
          <CodeBlock>{JSON.stringify(entry.input, null, 2)}</CodeBlock>
        </Section>
      )}

      {entry.stack && (
        <Section title="Stack Trace">
          <CodeBlock>{entry.stack}</CodeBlock>
        </Section>
      )}

      {hasHeaders && (
        <Section title="Headers">
          <div className="space-y-0">
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
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        {subtitle && <span className="text-[11px] text-muted-foreground/60">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      {children}
    </pre>
  )
}
