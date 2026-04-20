/**
 * Background tasks
 * ------------------
 *
 * A *task* is a procedure with two extra capabilities:
 *
 *   1. Programmatic `dispatch(input)` — call it directly, outside the
 *      HTTP pipeline. Used for async work (send-email, rebuild-index)
 *      and as the callback target for cron schedules.
 *   2. Optional `cron` spec — when set, the task is auto-registered
 *      with a `croner` job at `serve()` time.
 *
 * Tasks are built via the procedure builder:
 *
 *   s.$use(auth).$input(schema).$task({ name: 'send-email', resolve })
 *
 * Dispatch runs through the same root-wrap onion as the HTTP pipeline
 * so tenant scoping, trace propagation, and similar cross-cutting
 * concerns apply uniformly. When no root wraps are configured the
 * dispatch path reduces to a direct `await resolveFn(…)`.
 */

import { validateSchema } from './schema.ts'

import type { MiddlewareDef, WrapDef } from '../types.ts'
import type { AnySchema } from './schema.ts'

// ─── Public shapes ────────────────────────────────────────────────────

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
  /**
   * Dispatch the task. Pass the *parent* request's `ctx` as the second
   * argument to fold the dispatch into that request's trace span.
   */
  dispatch: undefined extends TInput
    ? (input?: TInput, ctx?: Record<string, unknown>) => Promise<TOutput>
    : (input: TInput, ctx?: Record<string, unknown>) => Promise<TOutput>
}

export interface TaskConfig {
  name: string
  cron?: string
  description?: string
}

// ─── Analytics callback ───────────────────────────────────────────────

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

/**
 * Module-global sink for task completion events. This is shared across
 * every silgi instance in the process — analytics is currently wired
 * through the process-default cron registry for the same reason.
 * Per-instance analytics is a future refactor; `setTaskAnalytics(null)`
 * detaches the sink.
 */
let onTaskComplete: TaskCompleteCallback | null = null

export function setTaskAnalytics(cb: TaskCompleteCallback | null): void {
  onTaskComplete = cb
}

// ─── Dispatch helpers ─────────────────────────────────────────────────

/** Round a millisecond duration to two decimal places — matches dashboard display. */
const round2 = (ms: number): number => Math.round(ms * 100) / 100

/**
 * Wrap `run` in the root-wrap onion. Root wraps are outermost-first, so
 * we fold from the end of the list: the last wrap wraps `run`, the one
 * before wraps that, and so on. When there are no wraps we just return
 * `run` unchanged — zero onion overhead.
 *
 * Same shape as `composeWraps` in `compile.ts`; kept here privately to
 * avoid a core → compile import cycle.
 */
function applyRootWraps(
  ctx: Record<string, unknown>,
  wraps: readonly WrapDef[],
  run: () => Promise<unknown>,
): Promise<unknown> {
  let chain: () => Promise<unknown> = run
  for (let i = wraps.length - 1; i >= 0; i--) {
    const wrap = wraps[i]!
    const next = chain
    chain = () => Promise.resolve(wrap.fn(ctx, next))
  }
  return chain()
}

/**
 * Lazy-loaded `RequestTrace` constructor. The analytics module is
 * optional — missing it must not break task dispatch — so we attempt
 * the import once and cache the outcome. `null` means "we've tried;
 * analytics is not available in this build".
 */
let requestTraceCtor: (new () => { spans: unknown[]; t0: number }) | null | undefined
async function getRequestTrace(): Promise<(new () => any) | null> {
  if (requestTraceCtor !== undefined) return requestTraceCtor
  try {
    const mod = await import('../plugins/analytics.ts')
    requestTraceCtor = mod.RequestTrace as unknown as new () => any
  } catch {
    requestTraceCtor = null
  }
  return requestTraceCtor
}

/** Shape of a trace span recorded against a parent request. */
interface TraceSpan {
  name: string
  kind: string
  durationMs: number
  startOffsetMs: number
  detail: string
  error?: string
}

/** Record this dispatch as a span on the parent request's trace, if one exists. */
function recordParentSpan(
  parentTrace: { spans: TraceSpan[]; t0: number } | undefined,
  name: string,
  spanStart: number,
  err?: unknown,
): void {
  if (!parentTrace) return
  const span: TraceSpan = {
    name: `task:${name}`,
    kind: 'queue',
    durationMs: round2(performance.now() - spanStart),
    startOffsetMs: round2(spanStart - parentTrace.t0),
    detail: `dispatch ${name}`,
  }
  if (err !== undefined) span.error = err instanceof Error ? err.message : String(err)
  parentTrace.spans.push(span)
}

// ─── createTaskFromProcedure ──────────────────────────────────────────

/**
 * Build a `TaskDef` from the procedure builder's `.$task()` configuration.
 *
 * @param rootWrapsGetter A *live* getter so a task constructed before
 *   `s.router()` stamps wraps still picks them up at dispatch time. The
 *   silgi instance threads a closure over its own rootWraps reference.
 *   Pass `null` when no wraps are configured — dispatch then skips the
 *   onion entirely.
 */
export function createTaskFromProcedure(
  config: TaskConfig,
  resolveFn: Function,
  inputSchema: AnySchema | null,
  use: readonly MiddlewareDef[] | null,
  contextFactory: (() => unknown | Promise<unknown>) | null,
  rootWrapsGetter: (() => readonly WrapDef[] | null) | null = null,
): TaskDef<any, any> {
  const { name, cron = null, description } = config
  if (!name) throw new TypeError('Task name is required')

  /**
   * Resolver called by the *HTTP* pipeline when the task is reachable
   * through the router tree. `ctx` already carries everything the
   * pipeline set up (base context, guards, trace), so we just forward.
   */
  const pipelineResolve = async (opts: any): Promise<unknown> => {
    return resolveFn({ input: opts.input, ctx: opts.ctx, name, scheduledTime: undefined })
  }

  /**
   * Programmatic dispatch — the one users call from another procedure
   * or a cron callback. Validates input, builds its own context, runs
   * the root-wrap onion around the resolver, records analytics.
   */
  const dispatch = async (rawInput?: unknown, parentCtx?: Record<string, unknown>): Promise<unknown> => {
    const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput
    const ctx: Record<string, unknown> = contextFactory
      ? ((await (contextFactory as Function)()) as Record<string, unknown>)
      : {}

    const parentTrace = (parentCtx as { trace?: { spans: TraceSpan[]; t0: number } } | undefined)?.trace
    const spanStart = parentTrace ? performance.now() : 0

    // Install a fresh trace on `ctx` so `trace(…)` calls inside the
    // resolver have somewhere to land. Cached so the import happens
    // at most once even under heavy dispatch traffic.
    const RequestTrace = await getRequestTrace()
    const selfTrace = RequestTrace ? new RequestTrace() : null
    if (selfTrace) ctx.trace = selfTrace

    const runResolver = (): Promise<unknown> =>
      Promise.resolve(resolveFn({ input, ctx, name, scheduledTime: undefined }))

    const wraps = rootWrapsGetter?.() ?? null
    const t0 = performance.now()

    try {
      const output = wraps && wraps.length > 0 ? await applyRootWraps(ctx, wraps, runResolver) : await runResolver()

      recordParentSpan(parentTrace, name, spanStart)
      onTaskComplete?.({
        taskName: name,
        trigger: 'dispatch',
        timestamp: Date.now(),
        durationMs: round2(performance.now() - t0),
        status: 'success',
        input,
        output,
        spans: selfTrace?.spans,
      })
      return output
    } catch (err) {
      recordParentSpan(parentTrace, name, spanStart, err)
      onTaskComplete?.({
        taskName: name,
        trigger: 'dispatch',
        timestamp: Date.now(),
        durationMs: round2(performance.now() - t0),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        input,
        spans: selfTrace?.spans,
      })
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
    resolve: pipelineResolve,
    route: description ? { summary: description, tags: ['Tasks'] } : null,
    meta: null,
    _contextFactory: contextFactory,
    dispatch: dispatch as any,
  }
}

// ─── Deduplicating task runner ────────────────────────────────────────

/**
 * In-flight dispatches keyed by task object.
 *
 * `runTask` coalesces concurrent calls so two callers asking for the
 * same task at once share a single execution. Useful for idempotent
 * background jobs that can be kicked off from multiple places.
 */
const running = new Map<TaskDef<any, any>, Promise<unknown>>()

export async function runTask<TInput, TOutput>(
  task: TaskDef<TInput, TOutput>,
  ...args: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Promise<TOutput> {
  const existing = running.get(task)
  if (existing) return existing as Promise<TOutput>

  const promise = task.dispatch(args[0] as any)
  running.set(task, promise)
  try {
    return await promise
  } finally {
    running.delete(task)
  }
}

// ─── Cron discovery + registry ────────────────────────────────────────

/**
 * Walk a router tree and collect every task that has a `cron` field set.
 * Nested namespaces are recursed into; we stop at any node already
 * tagged as a task so a task's internal structure is never inspected.
 */
export function collectCronTasks(def: Record<string, unknown>): Array<{ cron: string; task: TaskDef<any, any> }> {
  const result: Array<{ cron: string; task: TaskDef<any, any> }> = []
  for (const value of Object.values(def)) {
    if (!value || typeof value !== 'object') continue

    if ('_tag' in value && (value as { _tag: string })._tag === 'task') {
      const task = value as TaskDef<any, any>
      if (task.cron) result.push({ cron: task.cron, task })
    } else if (!('_tag' in value)) {
      result.push(...collectCronTasks(value as Record<string, unknown>))
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

export interface ScheduledTaskInfo {
  name: string
  cron: string
  description?: string
  nextRun: number | null
  lastRun: number | null
  runs: number
  errors: number
}

export interface CronRegistry {
  start: (cronTasks: Array<{ cron: string; task: TaskDef<any, any> }>) => Promise<void>
  stop: () => void
  list: () => ScheduledTaskInfo[]
}

/**
 * Create an isolated cron registry.
 *
 * Each silgi instance owns one, so `server.close()` on instance A
 * never stops instance B's jobs and `list()` never returns jobs from
 * another instance. The module-default registry below keeps the
 * legacy top-level exports working.
 */
export function createCronRegistry(): CronRegistry {
  const entries: CronJobEntry[] = []

  return {
    async start(cronTasks) {
      if (cronTasks.length === 0) return
      const { Cron } = await import('croner')

      for (const { cron, task } of cronTasks) {
        const entry: CronJobEntry = {
          name: task.route?.summary || cron,
          cron,
          description: task.route?.summary,
          job: null as unknown as CronJobEntry['job'],
          lastRun: null,
          runs: 0,
          errors: 0,
        }

        entry.job = new Cron(cron, async () => {
          entry.lastRun = Date.now()
          entry.runs++
          task.dispatch(undefined).catch((err: unknown) => {
            entry.errors++
            console.error(`[silgi] Cron task failed:`, err instanceof Error ? err.message : err)
          })
        })

        entries.push(entry)
      }
    },

    stop() {
      for (const entry of entries) entry.job.stop()
      entries.length = 0
    },

    list() {
      return entries.map((entry) => ({
        name: entry.name,
        cron: entry.cron,
        description: entry.description,
        nextRun: entry.job.nextRun()?.getTime() ?? null,
        lastRun: entry.lastRun,
        runs: entry.runs,
        errors: entry.errors,
      }))
    },
  }
}

// ─── Process-default registry (legacy) ────────────────────────────────

/**
 * Process-default cron registry.
 *
 * @deprecated
 * Shared state. Prefer {@link createCronRegistry} and give each silgi
 * instance its own. The module-default registry is retained so
 * existing imports of `startCronJobs` / `stopCronJobs` /
 * `getScheduledTasks` keep working; a future major will remove these
 * top-level re-exports.
 */
const defaultRegistry = createCronRegistry()

/** @deprecated Use {@link createCronRegistry} — each silgi instance owns its own. */
export const startCronJobs = defaultRegistry.start
/** @deprecated Use {@link createCronRegistry} — each silgi instance owns its own. */
export const stopCronJobs = defaultRegistry.stop
/** @deprecated Use {@link createCronRegistry} — each silgi instance owns its own. */
export const getScheduledTasks = defaultRegistry.list
