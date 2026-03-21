import { ErrorDetail } from '@/components/error-detail'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/hooks'
import { fmtMs, fmtTime } from '@/lib/format'
import { errorToMarkdown, errorToRedactedJson } from '@/lib/markdown'
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

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
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>Error not found</div>
    )
  }

  return (
    <div>
      {/* Header bar */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('errors')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Errors
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='font-mono text-sm font-medium'>{entry.procedure}</span>
        <Badge variant='destructive'>{entry.code}</Badge>
        <Badge variant='secondary'>{entry.status}</Badge>
        <Badge variant='secondary'>{fmtMs(entry.durationMs)}</Badge>
        {entry.spans.length > 0 && <Badge variant='secondary'>{entry.spans.length} spans</Badge>}
        <span className='text-[11px] text-muted-foreground'>{fmtTime(entry.timestamp)}</span>
        <div className='ml-auto flex gap-1'>
          <CopyBtn
            copied={copiedId === `md-${entry.id}`}
            onClick={() => copy(`md-${entry.id}`, errorToMarkdown(entry))}
          >
            md
          </CopyBtn>
          <CopyBtn
            copied={copiedId === `json-${entry.id}`}
            onClick={() => copy(`json-${entry.id}`, errorToRedactedJson(entry))}
          >
            json
          </CopyBtn>
        </div>
      </div>

      {/* Detail content */}
      <ErrorDetail entry={entry} />
    </div>
  )
}

function CopyBtn({ copied, onClick, children }: { copied: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={copied ? 'default' : 'outline'} size='xs' onClick={onClick}>
      <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} data-icon='inline-start' />
      {copied ? 'copied' : children}
    </Button>
  )
}
