import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
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
    return <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">Error not found</div>
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('errors')}
          className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          Back to errors
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="destructive">{entry.code}</Badge>
              <span className="text-xs tabular-nums text-muted-foreground">Status {entry.status}</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight">{entry.procedure}</h1>
            <p className="text-xs text-muted-foreground">
              {new Date(entry.timestamp).toISOString()} &middot; {fmtMs(entry.durationMs)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <CopyBtn copied={copiedId === `md-${entry.id}`} onClick={() => copy(`md-${entry.id}`, errorToMarkdown(entry))}>AI</CopyBtn>
            <CopyBtn copied={copiedId === `json-${entry.id}`} onClick={() => copy(`json-${entry.id}`, errorToRedactedJson(entry))}>JSON</CopyBtn>
          </div>
        </div>
      </div>
      <Separator className="mb-6" />
      <ErrorDetail entry={entry} />
    </div>
  )
}

function CopyBtn({ copied, onClick, children }: { copied: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={copied ? 'default' : 'outline'} size="xs" onClick={onClick}>
      <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} size={11} />
      {copied ? 'Copied' : children}
    </Button>
  )
}
