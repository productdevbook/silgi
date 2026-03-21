import { useMemo, useState, useCallback } from 'react'
import { Copy, Check, Maximize2 } from 'lucide-react'

import { DataTableInfinite } from '@/components/data-table/data-table-infinite'
import type { DataTableFilterField } from '@/components/data-table/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { errorToMarkdown, fmtMs, fmtTime, useCopy } from '../hooks'

import type { ErrorEntry } from '../hooks'
import type { ColumnDef } from '@tanstack/react-table'

// ── Column definitions ──────────────────────────────

const columns: ColumnDef<ErrorEntry>[] = [
  {
    accessorKey: 'code',
    header: 'Code',
    cell: ({ row }) => (
      <Badge variant='destructive' className='text-[10px]'>
        {row.original.code}
      </Badge>
    ),
    filterFn: 'arrSome',
    size: 120,
  },
  {
    accessorKey: 'procedure',
    header: 'Procedure',
    cell: ({ row }) => (
      <span className='font-medium text-primary'>{row.original.procedure}</span>
    ),
    size: 200,
  },
  {
    accessorKey: 'error',
    header: 'Message',
    cell: ({ row }) => (
      <span className='max-w-[300px] truncate block text-muted-foreground text-xs'>
        {row.original.error}
      </span>
    ),
    size: 300,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <span className='tabular-nums'>{row.original.status}</span>,
    size: 80,
  },
  {
    accessorKey: 'durationMs',
    header: 'Duration',
    cell: ({ row }) => (
      <span className='tabular-nums text-xs'>{fmtMs(row.original.durationMs)}</span>
    ),
    size: 100,
  },
  {
    accessorKey: 'timestamp',
    header: 'Time',
    cell: ({ row }) => (
      <span className='text-muted-foreground text-xs'>{fmtTime(row.original.timestamp)}</span>
    ),
    size: 140,
  },
  {
    accessorKey: 'spans',
    header: 'Spans',
    cell: ({ row }) => {
      const count = row.original.spans.length
      if (!count) return <span className='text-muted-foreground'>-</span>
      const hasError = row.original.spans.some((s) => s.error)
      return (
        <Badge variant={hasError ? 'destructive' : 'secondary'} className='text-[10px]'>
          {count} span{count > 1 ? 's' : ''}
        </Badge>
      )
    },
    size: 100,
    enableSorting: false,
    enableColumnFilter: false,
  },
]

// ── Filter fields ───────────────────────────────────

function getFilterFields(errors: ErrorEntry[]): DataTableFilterField<ErrorEntry>[] {
  const codes = [...new Set(errors.map((e) => e.code))]
  const procedures = [...new Set(errors.map((e) => e.procedure))]

  return [
    {
      type: 'checkbox',
      label: 'Error Code',
      value: 'code' as keyof ErrorEntry,
      options: codes.map((c) => ({ label: c, value: c })),
    },
    {
      type: 'checkbox',
      label: 'Procedure',
      value: 'procedure' as keyof ErrorEntry,
      options: procedures.map((p) => ({ label: p, value: p })),
    },
  ]
}

// ── Main component ──────────────────────────────────

export default function Errors({ errors }: { errors: ErrorEntry[] }) {
  const [dialogError, setDialogError] = useState<ErrorEntry | null>(null)
  const { copiedId, copy } = useCopy()

  const reversed = useMemo(() => [...errors].reverse(), [errors])
  const filterFields = useMemo(() => getFilterFields(errors), [errors])

  const noop = useCallback(async () => {}, [])
  const noopRefetch = useCallback(() => {}, [])

  if (!errors.length) {
    return <div className='flex h-[60vh] items-center justify-center text-sm text-muted-foreground'>No errors yet</div>
  }

  return (
    <div className='p-4'>
      <DataTableInfinite
        columns={columns}
        data={reversed}
        filterFields={filterFields}
        totalRows={errors.length}
        filterRows={reversed.length}
        totalRowsFetched={reversed.length}
        fetchNextPage={noop}
        refetch={noopRefetch}
        hasNextPage={false}
        isFetching={false}
        isLoading={false}
        getRowId={(row) => String(row.id)}
        getRowClassName={(row) => {
          return 'cursor-pointer'
        }}
        tableId='analytics-errors'
        toolbarActions={
          <span className='text-xs text-muted-foreground'>{errors.length} error{errors.length !== 1 ? 's' : ''}</span>
        }
      />

      {/* Error detail dialog */}
      <Dialog open={!!dialogError} onOpenChange={(open) => !open && setDialogError(null)}>
        <DialogContent showCloseButton className='max-w-3xl max-h-[90vh] overflow-hidden'>
          {dialogError && (
            <>
              <DialogHeader>
                <div className='flex items-center gap-2'>
                  <Badge variant='destructive'>{dialogError.code}</Badge>
                  <DialogTitle className='text-primary'>{dialogError.procedure}</DialogTitle>
                </div>
                <DialogDescription>
                  {new Date(dialogError.timestamp).toISOString()} · {fmtMs(dialogError.durationMs)}
                </DialogDescription>
              </DialogHeader>
              <div className='flex gap-2 mt-2'>
                <CopyBtn id={`dlg-md-${dialogError.id}`} copiedId={copiedId} onClick={() => copy(`dlg-md-${dialogError.id}`, errorToMarkdown(dialogError))}>
                  Copy for AI
                </CopyBtn>
                <CopyBtn
                  id={`dlg-json-${dialogError.id}`}
                  copiedId={copiedId}
                  onClick={() => {
                    const clean = { ...dialogError, headers: { ...dialogError.headers } }
                    if (clean.headers.authorization) clean.headers.authorization = '[REDACTED]'
                    copy(`dlg-json-${dialogError.id}`, JSON.stringify(clean, null, 2))
                  }}
                >
                  Copy JSON
                </CopyBtn>
              </div>
              <Separator />
              <ScrollArea className='max-h-[60vh]'>
                <ErrorDetailContent entry={dialogError} />
                <ScrollBar orientation='vertical' />
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Error detail content ────────────────────────────

function ErrorDetailContent({ entry: e }: { entry: ErrorEntry }) {
  return (
    <div className='space-y-4 text-sm'>
      <Section title='Details'>
        <dl className='grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-xs'>
          <dt className='text-muted-foreground'>Status</dt><dd>{e.status}</dd>
          <dt className='text-muted-foreground'>Duration</dt><dd>{fmtMs(e.durationMs)}</dd>
          <dt className='text-muted-foreground'>Time</dt><dd>{new Date(e.timestamp).toISOString()}</dd>
        </dl>
      </Section>

      {e.input !== undefined && e.input !== null && (
        <Section title='Input'>
          <pre className='overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs'>{JSON.stringify(e.input, null, 2)}</pre>
        </Section>
      )}

      {e.spans.length > 0 && (
        <Section title='Traced Operations'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className='text-right'>Duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {e.spans.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className='text-xs font-mono'>{s.name}</TableCell>
                  <TableCell className='text-right text-xs tabular-nums'>{fmtMs(s.durationMs)}</TableCell>
                  <TableCell>
                    {s.error ? (
                      <Badge variant='destructive' className='text-[10px]'>Error: {s.error}</Badge>
                    ) : (
                      <span className='text-xs text-muted-foreground'>OK</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {Object.keys(e.headers || {}).length > 0 && (
        <Section title='Headers'>
          <dl className='grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs font-mono'>
            {Object.entries(e.headers).map(([k, v]) => (
              <span key={k} className='contents'>
                <dt className='text-muted-foreground'>{k}</dt>
                <dd className='break-all'>{k === 'authorization' ? '[REDACTED]' : v}</dd>
              </span>
            ))}
          </dl>
        </Section>
      )}

      {e.stack && (
        <Section title='Stack Trace'>
          <pre className='overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs leading-relaxed'>{e.stack}</pre>
        </Section>
      )}

      <Section title='Error Message'>
        <pre className='overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs'>{e.error}</pre>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className='mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>{title}</h3>
      {children}
    </div>
  )
}

function CopyBtn({ id, copiedId, onClick, children }: { id: string; copiedId: string | null; onClick: () => void; children: React.ReactNode }) {
  const isCopied = copiedId === id
  return (
    <Button variant={isCopied ? 'default' : 'outline'} size='xs' onClick={onClick}>
      {isCopied ? <Check className='size-3' /> : <Copy className='size-3' />}
      {isCopied ? 'Copied!' : children}
    </Button>
  )
}
