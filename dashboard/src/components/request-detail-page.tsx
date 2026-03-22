import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/hooks'
import { fmtMs, fmtTime } from '@/lib/format'
import { requestTimingMarkdown, requestToMarkdown, requestToRedactedJson } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { ProcedureCall, RequestEntry, SpanKind } from '@/lib/types'

interface RequestDetailPageProps {
  requests: RequestEntry[]
  id: string
  navigate: (page: string) => void
}

export function RequestDetailPage({ requests, id, navigate }: RequestDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const entry = requests.find((r) => r.id === Number(id))

  if (!entry) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>Request not found</div>
    )
  }

  const totalSpans = entry.procedures.reduce((sum, p) => sum + p.spans.length, 0)

  return (
    <div>
      {/* Header */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('requests')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Requests
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='font-mono text-xs text-muted-foreground'>{entry.method}</span>
        <span className='font-mono text-sm font-medium'>{entry.path}</span>
        <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'}>{entry.status}</Badge>
        <Badge variant='secondary'>{fmtMs(entry.durationMs)}</Badge>
        {entry.procedures.length > 1 && <Badge variant='outline'>batch × {entry.procedures.length}</Badge>}
        {totalSpans > 0 && <Badge variant='secondary'>{totalSpans} spans</Badge>}
        <span className='text-[11px] text-muted-foreground'>{fmtTime(entry.timestamp)}</span>
        <div className='ml-auto flex gap-1'>
          <CopyBtn copied={copiedId === `md-${entry.id}`} onClick={() => copy(`md-${entry.id}`, requestToMarkdown(entry))}>
            md
          </CopyBtn>
          <CopyBtn copied={copiedId === `timing-${entry.id}`} onClick={() => copy(`timing-${entry.id}`, requestTimingMarkdown(entry))}>
            timing
          </CopyBtn>
          <CopyBtn copied={copiedId === `json-${entry.id}`} onClick={() => copy(`json-${entry.id}`, requestToRedactedJson(entry))}>
            json
          </CopyBtn>
        </div>
      </div>

      {/* HTTP Request Info + Procedures */}
      <div className='grid xl:grid-cols-[1.65fr_0.9fr]'>
        {/* Left: Procedures with waterfall */}
        <div className='xl:border-r'>
          {entry.procedures.map((proc, idx) => (
            <ProcedureSection key={idx} proc={proc} idx={idx} totalMs={entry.durationMs} totalProcs={entry.procedures.length} />
          ))}
        </div>

        {/* Right: HTTP metadata */}
        <div>
          <Section label='HTTP Request'>
            <div className='flex flex-col'>
              <KV label='id' value={String(entry.id)} />
              <KV label='method' value={entry.method} />
              <KV label='path' value={entry.path} />
              <KV label='status' value={String(entry.status)} danger={entry.status >= 400} />
              <KV label='duration' value={fmtMs(entry.durationMs)} />
              <KV label='procedures' value={String(entry.procedures.length)} />
              <KV label='total spans' value={String(totalSpans)} />
              <KV label='ip' value={entry.ip || '-'} />
              <KV label='time' value={fmtTime(entry.timestamp)} />
              {entry.isBatch && <KV label='batch' value='yes' />}
            </div>
          </Section>

          {totalSpans > 0 && (
            <Section label='Timing breakdown'>
              <TimingBreakdown procedures={entry.procedures} totalMs={entry.durationMs} />
            </Section>
          )}

          {Object.keys(entry.headers ?? {}).length > 0 && (
            <Section label='Request headers'>
              <div className='flex flex-col'>
                {Object.entries(entry.headers).map(([k, v]) => (
                  <KV key={k} label={k} value={v} />
                ))}
              </div>
            </Section>
          )}

          {entry.userAgent && (
            <Section label='User agent'>
              <p className='break-all font-mono text-[11px] text-muted-foreground'>{entry.userAgent}</p>
            </Section>
          )}

          {Object.keys(entry.responseHeaders ?? {}).length > 0 && (
            <Section label='Response headers'>
              <div className='flex flex-col'>
                {Object.entries(entry.responseHeaders).map(([k, v]) => (
                  <KV key={k} label={k} value={v} />
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function ProcedureSection({ proc, idx, totalMs, totalProcs }: { proc: ProcedureCall; idx: number; totalMs: number; totalProcs: number }) {
  const hasInput = proc.input !== undefined && proc.input !== null
  const hasOutput = proc.output !== undefined && proc.output !== null
  const emoji = proc.status >= 500 ? '💥' : proc.status >= 400 ? '⚠️' : '✅'

  return (
    <div className={cn(totalProcs > 1 && 'border-b last:border-0')}>
      {totalProcs > 1 && (
        <div className='flex items-center gap-2 border-b bg-muted/30 px-5 py-2 text-[11px]'>
          <span>{emoji}</span>
          <span className='font-mono font-medium'>{proc.procedure}</span>
          <Badge variant={proc.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>{proc.status}</Badge>
          <span className='text-muted-foreground'>{fmtMs(proc.durationMs)}</span>
          <span className='text-muted-foreground'>({proc.spans.length} spans)</span>
        </div>
      )}

      <Section label={totalProcs === 1 ? `${proc.procedure} — ${proc.spans.length} spans, ${fmtMs(proc.durationMs)} total` : `Span timeline`}>
        {proc.spans.length > 0 ? (
          <SpanWaterfall spans={proc.spans} totalMs={proc.durationMs} />
        ) : (
          <p className='text-sm text-muted-foreground'>No spans recorded.</p>
        )}
      </Section>

      {hasInput && (
        <Section label={totalProcs > 1 ? `Input (#${idx + 1})` : 'Input'}>
          <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed'>
            {JSON.stringify(proc.input, null, 2)}
          </pre>
        </Section>
      )}

      {hasOutput && (
        <Section label={totalProcs > 1 ? `Output (#${idx + 1})` : 'Output'}>
          <pre className='max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed'>
            {JSON.stringify(proc.output, null, 2)}
          </pre>
        </Section>
      )}

      {proc.error && (
        <Section label='Error'>
          <pre className='whitespace-pre-wrap font-mono text-[11px] text-destructive'>{proc.error}</pre>
        </Section>
      )}
    </div>
  )
}

function TimingBreakdown({ procedures, totalMs }: { procedures: ProcedureCall[]; totalMs: number }) {
  const allSpans = procedures.flatMap(p => p.spans)
  const byKind = new Map<string, number>()
  for (const s of allSpans) {
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
  }
  const tracedMs = [...byKind.values()].reduce((a, b) => a + b, 0)
  const appMs = Math.max(0, totalMs - tracedMs)
  const total = Math.max(totalMs, 0.1)

  const colors: Record<string, string> = {
    db: 'bg-purple-500',
    redis: 'bg-red-500',
    http: 'bg-blue-500',
    cache: 'bg-emerald-500',
    queue: 'bg-amber-500',
    email: 'bg-orange-500',
    ai: 'bg-cyan-500',
    custom: 'bg-zinc-400',
  }

  return (
    <div className='space-y-2'>
      <div className='flex h-2 overflow-hidden rounded-full bg-muted'>
        {[...byKind].map(([kind, ms]) => (
          <div key={kind} className={cn('h-full', colors[kind] ?? 'bg-zinc-400')} style={{ width: `${(ms / total) * 100}%` }} title={`${kind}: ${ms.toFixed(1)}ms`} />
        ))}
        {appMs > 0 && <div className='h-full bg-zinc-700' style={{ width: `${(appMs / total) * 100}%` }} title={`app: ${appMs.toFixed(1)}ms`} />}
      </div>
      <div className='flex flex-wrap gap-x-3 gap-y-1'>
        {[...byKind].map(([kind, ms]) => (
          <div key={kind} className='flex items-center gap-1.5 text-[11px]'>
            <div className={cn('size-2 rounded-full', colors[kind] ?? 'bg-zinc-400')} />
            <span className='text-muted-foreground'>{kind}</span>
            <span className='font-mono tabular-nums'>{ms.toFixed(1)}ms</span>
            <span className='text-muted-foreground'>({((ms / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
        {appMs > 0.1 && (
          <div className='flex items-center gap-1.5 text-[11px]'>
            <div className='size-2 rounded-full bg-zinc-700' />
            <span className='text-muted-foreground'>app</span>
            <span className='font-mono tabular-nums'>{appMs.toFixed(1)}ms</span>
          </div>
        )}
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

function CopyBtn({ copied, onClick, children }: { copied: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={copied ? 'default' : 'outline'} size='xs' onClick={onClick}>
      <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} data-icon='inline-start' />
      {copied ? 'copied' : children}
    </Button>
  )
}

// Keep SpanKind import used
const _: SpanKind = 'db'
void _
