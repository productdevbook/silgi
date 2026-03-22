import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtMs, fmtRelativeTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo } from 'react'

import type { RequestEntry, SpanKind } from '@/lib/types'

interface SessionDetailPageProps {
  requests: RequestEntry[]
  sessionId: string
  navigate: (page: string, id?: string) => void
}

export function SessionDetailPage({ requests, sessionId, navigate }: SessionDetailPageProps) {
  const sessionRequests = useMemo(
    () => requests.filter((r) => r.sessionId === sessionId).sort((a, b) => b.timestamp - a.timestamp),
    [requests, sessionId],
  )

  if (sessionRequests.length === 0) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>
        No requests found for session {sessionId}
      </div>
    )
  }

  const first = sessionRequests[sessionRequests.length - 1]!
  const last = sessionRequests[0]!
  const totalMs = sessionRequests.reduce((sum, r) => sum + r.durationMs, 0)
  const errorCount = sessionRequests.filter((r) => r.status >= 400).length
  const allSpans = sessionRequests.flatMap((r) => r.procedures.flatMap((p) => p.spans))
  const uniqueProcedures = new Set(sessionRequests.flatMap((r) => r.procedures.map((p) => p.procedure)))

  // Timing by kind across all requests
  const byKind = new Map<string, number>()
  for (const s of allSpans) {
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
  }

  const colors: Record<string, string> = {
    db: 'bg-purple-500', http: 'bg-blue-500', cache: 'bg-emerald-500',
    queue: 'bg-amber-500', email: 'bg-orange-500', ai: 'bg-cyan-500', custom: 'bg-zinc-400',
  }

  return (
    <div>
      {/* Header */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('requests')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Requests
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='text-sm font-medium'>Session</span>
        <Badge variant='secondary' className='font-mono text-[10px]'>{sessionId.slice(0, 13)}</Badge>
        <Badge variant='secondary'>{sessionRequests.length} requests</Badge>
        {errorCount > 0 && <Badge variant='destructive'>{errorCount} errors</Badge>}
        <Badge variant='secondary'>{allSpans.length} spans</Badge>
      </div>

      <div className='grid xl:grid-cols-[1.65fr_0.9fr]'>
        {/* Left: Request timeline */}
        <div className='xl:border-r'>
          <Section label={`Request timeline — ${sessionRequests.length} requests`}>
            <div className='flex flex-col'>
              {sessionRequests.map((req) => (
                <div
                  key={req.id}
                  className='flex cursor-pointer items-center gap-2 border-b border-dashed py-2 last:border-0 hover:bg-muted/20'
                  onClick={() => navigate('requests', String(req.id))}
                >
                  <span className='w-16 text-[11px] tabular-nums text-muted-foreground'>{fmtRelativeTime(req.timestamp)}</span>
                  <span className='font-mono text-[10px] text-muted-foreground'>{req.method}</span>
                  <span className='flex-1 truncate font-mono text-[11px]'>
                    {req.procedures.map((p) => p.procedure).join(', ')}
                  </span>
                  <Badge variant={req.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>
                    {req.status}
                  </Badge>
                  <span className='w-14 text-right font-mono text-[11px] tabular-nums text-muted-foreground'>
                    {fmtMs(req.durationMs)}
                  </span>
                  <Badge variant='secondary' className='text-[9px]'>
                    {req.procedures.reduce((s, p) => s + p.spans.length, 0)}
                  </Badge>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Right: Session stats */}
        <div>
          <Section label='Session info'>
            <div className='flex flex-col'>
              <KV label='session id' value={sessionId} />
              <KV label='first seen' value={fmtTime(first.timestamp)} />
              <KV label='last seen' value={fmtTime(last.timestamp)} />
              <KV label='requests' value={String(sessionRequests.length)} />
              <KV label='errors' value={String(errorCount)} danger={errorCount > 0} />
              <KV label='total time' value={fmtMs(totalMs)} />
              <KV label='avg time' value={fmtMs(totalMs / sessionRequests.length)} />
              <KV label='procedures' value={String(uniqueProcedures.size)} />
              <KV label='total spans' value={String(allSpans.length)} />
              <KV label='ip' value={last.ip || '-'} />
              <KV label='user agent' value={last.userAgent.slice(0, 50) || '-'} />
            </div>
          </Section>

          {byKind.size > 0 && (
            <Section label='Time by category (all requests)'>
              <div className='space-y-2'>
                <div className='flex h-2 overflow-hidden rounded-full bg-muted'>
                  {[...byKind].map(([kind, ms]) => (
                    <div key={kind} className={cn('h-full', colors[kind] ?? 'bg-zinc-400')} style={{ width: `${(ms / totalMs) * 100}%` }} title={`${kind}: ${ms.toFixed(1)}ms`} />
                  ))}
                </div>
                <div className='flex flex-wrap gap-x-3 gap-y-1'>
                  {[...byKind].map(([kind, ms]) => (
                    <div key={kind} className='flex items-center gap-1.5 text-[11px]'>
                      <div className={cn('size-2 rounded-full', colors[kind] ?? 'bg-zinc-400')} />
                      <span className='text-muted-foreground'>{kind}</span>
                      <span className='font-mono tabular-nums'>{ms.toFixed(1)}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}

          <Section label='Procedures called'>
            <div className='flex flex-wrap gap-1.5'>
              {[...uniqueProcedures].sort().map((proc) => {
                const count = sessionRequests.filter((r) => r.procedures.some((p) => p.procedure === proc)).length
                return (
                  <Badge key={proc} variant='outline' className='text-[10px]'>
                    {proc} <span className='ml-1 text-muted-foreground'>×{count}</span>
                  </Badge>
                )
              })}
            </div>
          </Section>
        </div>
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
      <span className={cn('max-w-[60%] truncate font-mono text-[11px]', danger && 'text-destructive')}>{value}</span>
    </div>
  )
}

// Keep import used
const _: SpanKind = 'db'
void _
