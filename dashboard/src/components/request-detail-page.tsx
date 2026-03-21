import { Badge } from '@/components/ui/badge'
import { BackButton, CodePanel, InsightPill, PageHero, PageShell, SectionCard } from '@/components/dashboard-shell'
import { SpanWaterfall } from '@/components/span-waterfall'
import { fmtMs } from '@/lib/format'

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
      <PageShell>
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Request not found</div>
      </PageShell>
    )
  }

  const hasInput = entry.input !== undefined && entry.input !== null

  return (
    <PageShell>
      <div className="flex flex-col gap-3">
        <BackButton onClick={() => navigate('requests')}>
          Back to requests
        </BackButton>
        <PageHero
          eyebrow="Request detail"
          title={entry.procedure}
          description="Inspect the recorded request path, its traced spans, and the input payload that produced this response."
          badges={
            <>
              <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'}>Status {entry.status}</Badge>
              <Badge variant="secondary">{fmtMs(entry.durationMs)}</Badge>
              <Badge variant="secondary">{entry.spans.length} spans</Badge>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InsightPill label="Status" value={String(entry.status)} meta="HTTP response status" />
            <InsightPill label="Duration" value={fmtMs(entry.durationMs)} meta="End-to-end duration" />
            <InsightPill label="Spans" value={String(entry.spans.length)} meta="Recorded internal operations" />
            <InsightPill label="Captured" value={new Date(entry.timestamp).toLocaleTimeString()} meta={new Date(entry.timestamp).toLocaleDateString()} />
          </div>
        </PageHero>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        {entry.spans.length > 0 && (
          <SectionCard
            title="Trace"
            subtitle={`${entry.spans.length} operations spanning ${fmtMs(entry.durationMs)} total`}
          >
            <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
          </SectionCard>
        )}
        {hasInput && (
          <SectionCard title="Input" subtitle="Payload captured for this request">
            <CodePanel>{JSON.stringify(entry.input, null, 2)}</CodePanel>
          </SectionCard>
        )}
      </div>
    </PageShell>
  )
}
