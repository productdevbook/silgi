import { ErrorDetail } from '@/components/error-detail'
import { ExportSelect } from '@/components/export-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/hooks'
import { fmtMs, fmtTime } from '@/lib/format'
import { errorMarkdownCurl, errorMarkdownUrl, errorToMarkdown, errorToRedactedJson } from '@/lib/markdown'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { ErrorEntry } from '@/lib/types'

interface ErrorDetailPageProps {
  errors: ErrorEntry[]
  id: string
  navigate: (page: string, id?: string) => void
}

export function ErrorDetailPage({ errors, id, navigate }: ErrorDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const entry = errors.find((e) => e.id === Number(id))

  if (!entry) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>Error not found</div>
    )
  }

  const exportOptions = [
    { id: `md-${entry.id}`, label: 'Markdown', text: errorToMarkdown(entry), hint: 'full' },
    { id: `md-url-${entry.id}`, label: 'Markdown URL', text: errorMarkdownUrl(entry), hint: '/md' },
    { id: `curl-${entry.id}`, label: 'cURL', text: errorMarkdownCurl(entry), hint: 'fetch md' },
    { id: `json-${entry.id}`, label: 'JSON', text: errorToRedactedJson(entry), hint: 'redacted' },
  ]

  return (
    <div>
      {/* Header bar */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('errors')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Errors
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='font-mono text-sm font-semibold'>{entry.procedure}</span>
        <Badge variant='destructive'>{entry.code}</Badge>
        <Badge variant='secondary'>{entry.status}</Badge>
        <Badge variant='secondary'>{fmtMs(entry.durationMs)}</Badge>
        {entry.spans.length > 0 && <Badge variant='secondary'>{entry.spans.length} spans</Badge>}
        {entry.requestId && (
          <Badge
            variant='outline'
            className='cursor-pointer font-mono text-[9px] hover:bg-muted'
            onClick={() => navigate('requests', entry.requestId)}
          >
            req:{entry.requestId.slice(0, 8)}
          </Badge>
        )}
        <span className='text-[11px] text-muted-foreground'>{fmtTime(entry.timestamp)}</span>
        <div className='ml-auto'>
          <ExportSelect copiedId={copiedId} onCopy={copy} options={exportOptions} />
        </div>
      </div>

      {/* Detail content */}
      <ErrorDetail entry={entry} />
    </div>
  )
}
