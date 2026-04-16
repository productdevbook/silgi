/**
 * Task API — type-safe background tasks built on the procedure builder.
 *
 * Tasks are procedures with dispatch + cron capabilities:
 *   s.$use(auth).$input(schema).$task({ name: 'send-email', resolve })
 */

import { validateSchema } from './schema.ts'

import type { MiddlewareDef } from '../types.ts'
import type { AnySchema } from './schema.ts'

// ── Types ────────────────────────────────────────────

export interface TaskEvent<TInput = unknown, TCtx = unknown> {
  input: TInput
  ctx: TCtx
  name: string
  scheduledTime?: number
}

export interface TaskDef<TInput = unknown, TOutput = unknown> {
  readonly _tag: 'task'
  readonly type: 'mutation'
  readonly cron: string | null
  readonly input: AnySchema | null
  readonly output: null
  readonly errors: null
  readonly use: readonly MiddlewareDef[] | null
  readonly resolve: Function
  readonly route: { summary?: string; tags?: string[] } | null
  readonly meta: null
  readonly _contextFactory: (() => unknown | Promise<unknown>) | null
  /** Dispatch the task. Pass ctx from a procedure to auto-record a trace span. */
  dispatch: undefined extends TInput
    ? (input?: TInput, ctx?: Record<string, unknown>) => Promise<TOutput>
    : (input: TInput, ctx?: Record<string, unknown>) => Promise<TOutput>
}

// ── Analytics callback ───────────────────────────────

export type TaskCompleteCallback = (entry: {
  taskName: string
  trigger: 'dispatch' | 'cron' | 'http'
  timestamp: number
  durationMs: number
  status: 'success' | 'error'
  error?: string
  input?: unknown
  output?: unknown
  spans?: unknown[]
}) => void

let _onTaskComplete: TaskCompleteCallback | null = null

export function setTaskAnalytics(cb: TaskCompleteCallback | null): void {
  _onTaskComplete = cb
}

// ── createTaskFromProcedure — called by builder.$task() ──

export interface TaskConfig {
  name: string
  cron?: string
  description?: string
}

export function createTaskFromProcedure(
  config: TaskConfig,
  resolveFn: Function,
  inputSchema: AnySchema | null,
  use: readonly MiddlewareDef[] | null,
  contextFactory: (() => unknown | Promise<unknown>) | null,
): TaskDef<any, any> {
  const { name, cron = null, description } = config

  if (!name) throw new TypeError('Task name is required')

  // Handler resolve — called by Silgi pipeline (ctx comes from pipeline)
  const taskResolve = async (opts: any) => {
    return resolveFn({ input: opts.input, ctx: opts.ctx, name, scheduledTime: undefined })
  }

  // Programmatic dispatch
  const dispatch = async (rawInput?: unknown, parentCtx?: Record<string, unknown>) => {
    const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput
    const ctx: any = contextFactory ? await (contextFactory as Function)() : {}

    // If parent ctx passed, record span on parent request trace
    const parentTrace = (parentCtx as any)?.trace
    const spanStart = parentTrace ? performance.now() : 0

    // Inject RequestTrace for trace() calls inside the task
    let reqTrace: any = null
    try {
      const { RequestTrace } = await import('../plugins/analytics.ts')
      reqTrace = new RequestTrace()
      ctx.trace = reqTrace
    } catch {}

    const t0 = performance.now()
    try {
      const output = await resolveFn({ input, ctx, name, scheduledTime: undefined })

      if (parentTrace) {
        parentTrace.spans.push({
          name: `task:${name}`,
          kind: 'queue',
          durationMs: Math.round((performance.now() - spanStart) * 100) / 100,
          startOffsetMs: Math.round((spanStart - parentTrace.t0) * 100) / 100,
          detail: `dispatch ${name}`,
        })
      }

      if (_onTaskComplete) {
        _onTaskComplete({
          taskName: name,
          trigger: 'dispatch',
          timestamp: Date.now(),
          durationMs: Math.round((performance.now() - t0) * 100) / 100,
          status: 'success',
          input,
          output,
          spans: reqTrace?.spans,
        })
      }
      return output
    } catch (err) {
      if (parentTrace) {
        parentTrace.spans.push({
          name: `task:${name}`,
          kind: 'queue',
          durationMs: Math.round((performance.now() - spanStart) * 100) / 100,
          startOffsetMs: Math.round((spanStart - parentTrace.t0) * 100) / 100,
          detail: `dispatch ${name}`,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      if (_onTaskComplete) {
        _onTaskComplete({
          taskName: name,
          trigger: 'dispatch',
          timestamp: Date.now(),
          durationMs: Math.round((performance.now() - t0) * 100) / 100,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          input,
          spans: reqTrace?.spans,
        })
      }
      throw err
    }
  }

  return {
    _tag: 'task',
    type: 'mutation',
    cron,
    input: inputSchema,
    output: null,
    errors: null,
    use,
    resolve: taskResolve,
    route: description ? { summary: description, tags: ['Tasks'] } : null,
    meta: null,
    _contextFactory: contextFactory,
    dispatch: dispatch as any,
  }
}

// ── runTask ──────────────────────────────────────────

const _running = new Map<TaskDef<any, any>, Promise<unknown>>()

export async function runTask<TInput, TOutput>(
  task: TaskDef<TInput, TOutput>,
  ...args: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Promise<TOutput> {
  const existing = _running.get(task)
  if (existing) return existing as Promise<TOutput>

  const promise = task.dispatch(args[0] as any)
  _running.set(task, promise)
  try {
    return await promise
  } finally {
    _running.delete(task)
  }
}

// ── Cron — auto-discover from router ─────────────────

export function collectCronTasks(def: Record<string, unknown>): Array<{ cron: string; task: TaskDef<any, any> }> {
  const result: Array<{ cron: string; task: TaskDef<any, any> }> = []
  for (const value of Object.values(def)) {
    if (value && typeof value === 'object') {
      if ('_tag' in value && (value as any)._tag === 'task' && (value as any).cron) {
        result.push({ cron: (value as any).cron, task: value as TaskDef<any, any> })
      } else if (!('_tag' in value)) {
        result.push(...collectCronTasks(value as Record<string, unknown>))
      }
    }
  }
  return result
}

interface CronJobEntry {
  name: string
  cron: string
  description?: string
  job: { stop: () => void; nextRun: () => Date | null }
  lastRun: number | null
  runs: number
  errors: number
}

let _cronEntries: CronJobEntry[] = []

export async function startCronJobs(cronTasks: Array<{ cron: string; task: TaskDef<any, any> }>): Promise<void> {
  if (cronTasks.length === 0) return
  const { Cron } = await import('croner')
  for (const { cron, task } of cronTasks) {
    const taskName = (task as any).route?.summary || cron
    const entry: CronJobEntry = {
      name: taskName,
      cron,
      description: task.route?.summary,
      job: null as any,
      lastRun: null,
      runs: 0,
      errors: 0,
    }
    const job = new Cron(cron, async () => {
      entry.lastRun = Date.now()
      entry.runs++
      task.dispatch(undefined).catch((err: unknown) => {
        entry.errors++
        console.error(`[silgi] Cron task failed:`, err instanceof Error ? err.message : err)
      })
    })
    entry.job = job
    _cronEntries.push(entry)
  }
}

export interface ScheduledTaskInfo {
  name: string
  cron: string
  description?: string
  nextRun: number | null
  lastRun: number | null
  runs: number
  errors: number
}

export function getScheduledTasks(): ScheduledTaskInfo[] {
  return _cronEntries.map((e) => ({
    name: e.name,
    cron: e.cron,
    description: e.description,
    nextRun: e.job.nextRun()?.getTime() ?? null,
    lastRun: e.lastRun,
    runs: e.runs,
    errors: e.errors,
  }))
}

export function stopCronJobs(): void {
  for (const e of _cronEntries) e.job.stop()
  _cronEntries = []
}
