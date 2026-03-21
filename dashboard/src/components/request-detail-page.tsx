import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
    return <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">Request not found</div>
  }

  const hasInput = entry.input !== undefined && entry.input !== null

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('requests')}
          className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          Back to requests
        </button>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">200</Badge>
            <span className="text-xs tabular-nums text-muted-foreground">{fmtMs(entry.durationMs)}</span>
            <span className="text-xs text-muted-foreground">&middot;</span>
            <span className="text-xs text-muted-foreground">{entry.spans.length} spans</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{entry.procedure}</h1>
          <p className="text-xs text-muted-foreground">{new Date(entry.timestamp).toISOString()}</p>
        </div>
      </div>

      <Separator className="mb-6" />

      <div className="space-y-8">
        {entry.spans.length > 0 && (
          <Section title="Trace" subtitle={`${entry.spans.length} operations · ${fmtMs(entry.durationMs)} total`}>
            <SpanWaterfall spans={entry.spans} totalMs={entry.durationMs} />
          </Section>
        )}
        {hasInput && (
          <Section title="Input">
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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
