/**
 * Task API — type-safe background tasks with context, cron, and router mount.
 *
 * @example
 * ```ts
 * const sendEmail = s.task(
 *   z.object({ userId: z.string() }),
 *   async ({ input, ctx }) => {
 *     const user = await ctx.db.users.get(input.userId)
 *     await mailer.send(user.email, 'Welcome')
 *   },
 * )
 * ```
 */

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './schema.ts'
import { validateSchema } from './schema.ts'

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
  readonly use: null
  readonly resolve: Function
  readonly route: { summary?: string; tags?: string[] } | null
  readonly meta: null
  /** Internal: context factory for programmatic dispatch */
  readonly _contextFactory: (() => unknown | Promise<unknown>) | null
  /** Type-safe dispatch — validates input, creates context, runs */
  dispatch: undefined extends TInput
    ? (input?: TInput) => Promise<TOutput>
    : (input: TInput) => Promise<TOutput>
}

export interface TaskOptions<TCtx, TInput, TOutput> {
  cron?: string
  name?: string
  description?: string
  resolve: (event: TaskEvent<TInput, TCtx>) => Promise<TOutput> | TOutput
}

// ── defineTask (standalone, no context) ──────────────

/** Define a standalone task without input */
export function defineTask<TOutput>(
  resolve: (event: TaskEvent<undefined, {}>) => Promise<TOutput> | TOutput,
): TaskDef<undefined, TOutput>

/** Define a standalone task with input schema */
export function defineTask<TSchema extends AnySchema, TOutput>(
  input: TSchema,
  resolve: (event: TaskEvent<InferSchemaOutput<TSchema>, {}>) => Promise<TOutput> | TOutput,
): TaskDef<InferSchemaInput<TSchema>, TOutput>

/** Define a standalone task with config */
export function defineTask<TOutput>(
  options: { cron?: string; name?: string; description?: string; resolve: (event: TaskEvent<undefined, {}>) => Promise<TOutput> | TOutput },
): TaskDef<undefined, TOutput>

/** Define a standalone task with input schema + config */
export function defineTask<TSchema extends AnySchema, TOutput>(
  input: TSchema,
  options: { cron?: string; name?: string; description?: string; resolve: (event: TaskEvent<InferSchemaOutput<TSchema>, {}>) => Promise<TOutput> | TOutput },
): TaskDef<InferSchemaInput<TSchema>, TOutput>

export function defineTask(...args: any[]): TaskDef<any, any> {
  return createTaskDef(null, ...args)
}

// ── createTaskDef (shared impl, ctx factory optional) ─

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

/** Register a global callback for task completion — used by analytics plugin. */
export function setTaskAnalytics(cb: TaskCompleteCallback | null): void {
  _onTaskComplete = cb
}

export function createTaskDef(contextFactory: (() => unknown | Promise<unknown>) | null, ...args: any[]): TaskDef<any, any> {
  let inputSchema: AnySchema | null = null
  let resolve: Function
  let cron: string | null = null
  let name = ''
  let description: string | undefined

  if (args.length === 1 && typeof args[0] === 'function') {
    resolve = args[0]
  } else if (args.length === 1 && typeof args[0] === 'object') {
    resolve = args[0].resolve
    cron = args[0].cron ?? null
    name = args[0].name ?? ''
    description = args[0].description
  } else if (args.length === 2 && typeof args[1] === 'function') {
    inputSchema = args[0]
    resolve = args[1]
  } else if (args.length === 2 && typeof args[1] === 'object') {
    inputSchema = args[0]
    resolve = args[1].resolve
    cron = args[1].cron ?? null
    name = args[1].name ?? ''
    description = args[1].description
  } else {
    throw new TypeError('Invalid task arguments')
  }

  // Handler resolve — called by Silgi pipeline (ctx comes from pipeline)
  const taskResolve = async (opts: any) => {
    return resolve({ input: opts.input, ctx: opts.ctx, name, scheduledTime: undefined })
  }

  // Programmatic dispatch — creates ctx from factory, injects trace, tracks analytics
  const dispatch = async (rawInput?: unknown) => {
    const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput
    const ctx = contextFactory ? await (contextFactory as Function)() : {}

    // Inject RequestTrace so trace() calls inside the task produce spans
    let reqTrace: any = null
    try {
      const { RequestTrace } = await import('../plugins/analytics.ts')
      reqTrace = new RequestTrace()
      ;(ctx as any).__analyticsTrace = reqTrace
    } catch {}

    const t0 = performance.now()
    try {
      const output = await resolve({ input, ctx, name, scheduledTime: undefined })
      if (_onTaskComplete) {
        _onTaskComplete({ taskName: name, trigger: 'dispatch', timestamp: Date.now(), durationMs: Math.round((performance.now() - t0) * 100) / 100, status: 'success', input, output, spans: reqTrace?.spans })
      }
      return output
    } catch (err) {
      if (_onTaskComplete) {
        _onTaskComplete({ taskName: name, trigger: 'dispatch', timestamp: Date.now(), durationMs: Math.round((performance.now() - t0) * 100) / 100, status: 'error', error: err instanceof Error ? err.message : String(err), input, spans: reqTrace?.spans })
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
    use: null,
    resolve: taskResolve,
    route: description ? { summary: description, tags: ['Tasks'] } : null,
    meta: null,
    _contextFactory: contextFactory,
    __cronName: name,
    dispatch: dispatch as any,
  } as any
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
    const taskName = (task as any).__cronName || cron
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
