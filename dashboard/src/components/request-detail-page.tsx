import { SpanWaterfall } from '@/components/span-waterfall'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopy } from '@/hooks'
import { fmtMs, fmtTime } from '@/lib/format'
import { requestTimingMarkdown, requestToMarkdown, requestToRedactedJson } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo } from 'react'
import { Cell, Pie, PieChart } from 'recharts'

import { ChartContainer, ChartTooltip } from '@/components/ui/chart'

import type { ProcedureCall, RequestEntry } from '@/lib/types'

// ── Constants ──

const KIND_HEX: Record<string, string> = {
  db: '#a855f7', redis: '#ef4444', http: '#3b82f6', cache: '#10b981',
  queue: '#f59e0b', email: '#f97316', ai: '#06b6d4', custom: '#a1a1aa',
}

// ── Main component ──

interface RequestDetailPageProps {
  requests: RequestEntry[]
  id: string
  navigate: (page: string, id?: string) => void
}

export function RequestDetailPage({ requests, id, navigate }: RequestDetailPageProps) {
  const { copiedId, copy } = useCopy()
  const numId = Number(id)
  const entry = requests.find((r) => (Number.isNaN(numId) ? r.requestId === id : r.id === numId))

  if (!entry) {
    return (
      <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>Request not found</div>
    )
  }

  const totalSpans = entry.procedures.reduce((sum, p) => sum + p.spans.length, 0)

  return (
    <div className='flex min-h-full flex-col'>
      {/* ── Header ── */}
      <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
        <Button variant='ghost' size='xs' onClick={() => navigate('requests')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Requests
        </Button>
        <span className='text-muted-foreground'>/</span>
        <span className='font-mono text-xs text-muted-foreground'>{entry.method}</span>
        <span className='font-mono text-sm font-semibold'>{entry.path}</span>
        <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'}>{entry.status}</Badge>
        <Badge variant='secondary'>{fmtMs(entry.durationMs)}</Badge>
        {entry.procedures.length > 1 && <Badge variant='outline'>batch x {entry.procedures.length}</Badge>}
        {totalSpans > 0 && <Badge variant='secondary'>{totalSpans} spans</Badge>}
        <span className='text-[11px] text-muted-foreground'>{fmtTime(entry.timestamp)}</span>
        <div className='ml-auto flex gap-1'>
          <CopyBtn copied={copiedId === `md-${entry.id}`} onClick={() => copy(`md-${entry.id}`, requestToMarkdown(entry))}>md</CopyBtn>
          <CopyBtn copied={copiedId === `timing-${entry.id}`} onClick={() => copy(`timing-${entry.id}`, requestTimingMarkdown(entry))}>timing</CopyBtn>
          <CopyBtn copied={copiedId === `json-${entry.id}`} onClick={() => copy(`json-${entry.id}`, requestToRedactedJson(entry))}>json</CopyBtn>
        </div>
      </div>

      {/* ── Body: procedures + metadata ── */}
      <div className='grid flex-1 xl:grid-cols-[1.65fr_0.9fr]'>
        {/* Left: procedures with waterfall */}
        <div className='xl:border-r'>
          {entry.procedures.map((proc, idx) => (
            <ProcedureSection key={idx} proc={proc} idx={idx} totalMs={entry.durationMs} totalProcs={entry.procedures.length} />
          ))}
        </div>

        {/* Right: HTTP metadata */}
        <div>
          <Section label='HTTP Request'>
            <KV label='id' value={String(entry.id)} />
            <KV label='method' value={entry.method} />
            <KV label='path' value={entry.path} />
            <KV label='status' value={String(entry.status)} danger={entry.status >= 400} />
            <KV label='duration' value={fmtMs(entry.durationMs)} />
            <KV label='procedures' value={String(entry.procedures.length)} />
            <KV label='total spans' value={String(totalSpans)} />
            <KV label='ip' value={entry.ip || '-'} />
            <KV label='time' value={fmtTime(entry.timestamp)} />
            {entry.sessionId && (
              <div className='flex items-center justify-between border-b border-dashed py-1.5 last:border-0'>
                <span className='text-[11px] text-muted-foreground'>session</span>
                <Badge
                  variant='outline'
                  className='cursor-pointer font-mono text-[10px] hover:bg-muted'
                  onClick={() => navigate('sessions', entry.sessionId)}
                >
                  {entry.sessionId.slice(0, 12)}
                </Badge>
              </div>
            )}
            {entry.isBatch && <KV label='batch' value='yes' />}
          </Section>

          {totalSpans > 0 && (
            <Section label='Timing breakdown'>
              <TimingDonut procedures={entry.procedures} totalMs={entry.durationMs} />
            </Section>
          )}

          {Object.keys(entry.headers ?? {}).length > 0 && (
            <Section label='Request headers'>
              {Object.entries(entry.headers).map(([k, v]) => (
                <KV key={k} label={k} value={v} />
              ))}
            </Section>
          )}

          {entry.userAgent && (
            <Section label='User agent'>
              <p className='break-all font-mono text-[11px] text-muted-foreground'>{entry.userAgent}</p>
            </Section>
          )}

          {Object.keys(entry.responseHeaders ?? {}).length > 0 && (
            <Section label='Response headers'>
              {Object.entries(entry.responseHeaders).map(([k, v]) => (
                <KV key={k} label={k} value={v} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Procedure section ──

function ProcedureSection({ proc, idx, totalMs, totalProcs }: { proc: ProcedureCall; idx: number; totalMs: number; totalProcs: number }) {
  const hasInput = proc.input !== undefined && proc.input !== null
  const hasOutput = proc.output !== undefined && proc.output !== null

  return (
    <div className={cn(totalProcs > 1 && 'border-b last:border-0')}>
      {totalProcs > 1 && (
        <div className='flex items-center gap-2 border-b bg-muted/30 px-5 py-2 text-[11px]'>
          <span className={cn('size-1.5 rounded-full', proc.status >= 400 ? 'bg-destructive' : 'bg-emerald-500')} />
          <span className='font-mono font-semibold'>{proc.procedure}</span>
          <Badge variant={proc.status >= 400 ? 'destructive' : 'secondary'} className='text-[9px]'>{proc.status}</Badge>
          <span className='text-muted-foreground'>{fmtMs(proc.durationMs)}</span>
          <span className='text-muted-foreground'>({proc.spans.length} spans)</span>
        </div>
      )}

      <Section label={totalProcs === 1 ? `${proc.procedure} — ${proc.spans.length} spans, ${fmtMs(proc.durationMs)} total` : 'Span timeline'}>
        {proc.spans.length > 0 ? (
          <SpanWaterfall spans={proc.spans} totalMs={proc.durationMs} />
        ) : (
          <p className='text-sm text-muted-foreground'>No spans recorded.</p>
        )}
      </Section>

      {hasInput && (
        <Section label={totalProcs > 1 ? `Input (#${idx + 1})` : 'Input'}>
          <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
            {JSON.stringify(proc.input, null, 2)}
          </pre>
        </Section>
      )}

      {hasOutput && (
        <Section label={totalProcs > 1 ? `Output (#${idx + 1})` : 'Output'}>
          <pre className='max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed'>
            {JSON.stringify(proc.output, null, 2)}
          </pre>
        </Section>
      )}

      {proc.error && (
        <Section label='Error'>
          <div className='rounded-md bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive'>{proc.error}</div>
        </Section>
      )}
    </div>
  )
}

// ── Timing donut (same style as session page) ──

function TimingDonut({ procedures, totalMs }: { procedures: ProcedureCall[]; totalMs: number }) {
  const data = useMemo(() => {
    const byKind = new Map<string, number>()
    for (const p of procedures) {
      for (const s of p.spans) {
        byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
      }
    }
    const tracedMs = [...byKind.values()].reduce((a, b) => a + b, 0)
    const appMs = Math.max(0, totalMs - tracedMs)
    const items = [...byKind].map(([kind, ms]) => ({ name: kind, value: ms, fill: KIND_HEX[kind] ?? '#a1a1aa' }))
    if (appMs > 0.1) items.push({ name: 'app', value: appMs, fill: '#3f3f46' })
    return items
  }, [procedures, totalMs])

  return (
    <div className='flex items-center gap-4'>
      <ChartContainer config={{ value: { label: 'Time' } }} className='h-24 w-24 shrink-0'>
        <PieChart>
          <Pie data={data} dataKey='value' nameKey='name' cx='50%' cy='50%' innerRadius={22} outerRadius={38} strokeWidth={1} stroke='var(--background)'>
            {data.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
          </Pie>
          <text x='50%' y='50%' textAnchor='middle' dominantBaseline='middle' className='fill-foreground text-[10px] font-semibold'>
            {fmtMs(totalMs)}
          </text>
          <ChartTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const d = payload[0].payload as (typeof data)[number]
              return (
                <div className='rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm'>
                  <span className='font-semibold'>{d.name}</span>
                  <span className='ml-2 text-muted-foreground'>{d.value.toFixed(1)}ms</span>
                  <span className='ml-1 text-muted-foreground'>({((d.value / totalMs) * 100).toFixed(0)}%)</span>
                </div>
              )
            }}
          />
        </PieChart>
      </ChartContainer>
      <div className='flex flex-col gap-1'>
        {data.map((entry) => (
          <div key={entry.name} className='flex items-center gap-1.5 text-[10px]'>
            <div className='size-2 shrink-0 rounded-full' style={{ backgroundColor: entry.fill }} />
            <span className='text-muted-foreground'>{entry.name}</span>
            <span className='font-mono tabular-nums'>{entry.value.toFixed(1)}ms</span>
            <span className='text-muted-foreground/50'>{((entry.value / totalMs) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared primitives ──

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='border-b px-5 py-4 last:border-b-0'>
      <h4 className='mb-3 text-[11px] font-semibold text-muted-foreground'>{label}</h4>
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

function CopyBtn({ copied, onClick, children }: { copied: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={copied ? 'default' : 'outline'} size='xs' onClick={onClick}>
      <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} data-icon='inline-start' />
      {copied ? 'copied' : children}
    </Button>
  )
}
