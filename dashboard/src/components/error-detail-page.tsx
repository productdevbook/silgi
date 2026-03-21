import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BackButton, InsightPill, PageHero, PageShell } from '@/components/dashboard-shell'
import { ErrorDetail } from '@/components/error-detail'
import { useCopy } from '@/hooks'
import { fmtMs } from '@/lib/format'
import { errorToMarkdown, errorToRedactedJson } from '@/lib/markdown'

import type { ErrorEntry } from '@/lib/types'

interface ErrorDetailPageProps {
  errors: ErrorEntry[]
  id: string
  navigate: (page: string) => void
}

export function ErrorDetailPage({ errors, id, navigate }: ErrorDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const entry = errors.find((e) => e.id === Number(id))

  if (!entry) {
    return (
      <PageShell>
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Error not found</div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-3">
        <BackButton onClick={() => navigate('errors')}>
          Back to errors
        </BackButton>
        <PageHero
          eyebrow="Error detail"
          title={entry.procedure}
          description="Inspect the exact failure context, including stack trace, payload, request headers, and traced spans."
          badges={
            <>
              <Badge variant="destructive">{entry.code}</Badge>
              <Badge variant="secondary">Status {entry.status}</Badge>
              <Badge variant="secondary">{fmtMs(entry.durationMs)}</Badge>
            </>
          }
          actions={
            <>
              <CopyBtn copied={copiedId === `md-${entry.id}`} onClick={() => copy(`md-${entry.id}`, errorToMarkdown(entry))}>
                AI
              </CopyBtn>
              <CopyBtn copied={copiedId === `json-${entry.id}`} onClick={() => copy(`json-${entry.id}`, errorToRedactedJson(entry))}>
                JSON
              </CopyBtn>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InsightPill label="Code" value={entry.code} meta="Silgi error code" />
            <InsightPill label="Status" value={String(entry.status)} meta="HTTP response status" />
            <InsightPill label="Duration" value={fmtMs(entry.durationMs)} meta="End-to-end duration" />
            <InsightPill label="Captured" value={new Date(entry.timestamp).toLocaleTimeString()} meta={new Date(entry.timestamp).toLocaleDateString()} />
          </div>
        </PageHero>
      </div>
      <ErrorDetail entry={entry} />
    </PageShell>
  )
}

function CopyBtn({ copied, onClick, children }: { copied: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={copied ? 'default' : 'outline'} size="xs" onClick={onClick}>
      <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} data-icon="inline-start" />
      {copied ? 'Copied' : children}
    </Button>
  )
}
