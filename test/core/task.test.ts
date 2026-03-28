import { describe, it, expect, expectTypeOf, afterEach } from 'vitest'
import { z } from 'zod'

import { runTask, collectCronTasks, setTaskAnalytics } from '#src/core/task.ts'
import { silgi } from '#src/silgi.ts'

import type { TaskDef } from '#src/core/task.ts'

const s = silgi({ context: () => ({}) })

// ── $task() from builder ────────────────────────────

describe('$task()', () => {
  it('no-input task', async () => {
    const task = s.$task({ name: 'count', resolve: async () => ({ count: 42 }) })
    expect(task._tag).toBe('task')
    expect(task.type).toBe('mutation')
    expect(await task.dispatch()).toEqual({ count: 42 })
  })

  it('with input schema', async () => {
    const task = s
      .$input(z.object({ name: z.string() }))
      .$task({ name: 'greet', resolve: async ({ input }) => `hello ${input.name}` })
    expect(await task.dispatch({ name: 'world' })).toBe('hello world')
  })

  it('validates input', async () => {
    const task = s
      .$input(z.object({ count: z.number() }))
      .$task({ name: 'double', resolve: async ({ input }) => input.count * 2 })
    await expect(task.dispatch({ count: 'bad' } as any)).rejects.toThrow()
  })

  it('with cron + description', () => {
    const task = s.$task({
      name: 'cleanup',
      cron: '0 9 * * *',
      description: 'Clean old records',
      resolve: async () => ({ deleted: 5 }),
    })
    expect(task.cron).toBe('0 9 * * *')
    expect(task.route?.summary).toBe('Clean old records')
  })

  it('throws without name', () => {
    expect(() => s.$task({ resolve: async () => 'ok' } as any)).toThrow('Task name is required')
  })
})

// ── $task() with guards ─────────────────────────────

describe('$task() with guards', () => {
  it('guard use[] is attached to task', () => {
    const auth = s.guard(() => ({ userId: 1 }))
    const task = s
      .$use(auth)
      .$input(z.object({ email: z.string() }))
      .$task({ name: 'send', resolve: async ({ input, ctx }) => ({ to: input.email, by: ctx.userId }) })

    expect(task.use).toHaveLength(1)
    expect(task._tag).toBe('task')
  })

  it('multiple guards chain into task', () => {
    const auth = s.guard(() => ({ userId: 1 }))
    const store = s.guard(() => ({ storeId: 'abc' }))
    const task = s
      .$use(auth)
      .$use(store)
      .$task({ name: 'multi', resolve: async ({ ctx }) => `${ctx.userId}-${ctx.storeId}` })

    expect(task.use).toHaveLength(2)
  })

  it('ctx is typed with guard output', () => {
    const k = silgi({ context: () => ({ db: 'pg' }) })
    const auth = k.guard(() => ({ user: { id: 1, role: 'admin' as const } }))

    k.$use(auth)
      .$input(z.object({ id: z.number() }))
      .$task({
        name: 'typed-ctx',
        resolve: async ({ input, ctx }) => {
          expectTypeOf(ctx.user.role).toEqualTypeOf<'admin'>()
          expectTypeOf(ctx.db).toBeString()
          expectTypeOf(input).toEqualTypeOf<{ id: number }>()
          return true
        },
      })
  })
})

// ── Router mount ────────────────────────────────────

describe('router mount', () => {
  it('task mounts directly on router', () => {
    const task = s
      .$input(z.object({ to: z.string() }))
      .$task({ name: 'send-email', resolve: async () => ({ sent: true }) })

    const router = s.router({ tasks: { sendEmail: task } })
    expect(router.tasks.sendEmail._tag).toBe('task')
    expect(router.tasks.sendEmail.type).toBe('mutation')
  })

  it('guarded task in router', () => {
    const auth = s.guard(() => ({ userId: 1 }))
    const task = s.$use(auth).$task({ name: 'protected', resolve: async () => 'secret' })

    const router = s.router({ tasks: { protected: task } })
    expect(router.tasks.protected.use).toHaveLength(1)
  })
})

// ── runTask — singleton dedup ───────────────────────

describe('runTask', () => {
  it('returns result', async () => {
    const task = s.$task({ name: 'num', resolve: async () => 42 })
    expect(await runTask(task)).toBe(42)
  })

  it('deduplicates concurrent runs', async () => {
    let callCount = 0
    const task = s.$task({
      name: 'dedup',
      resolve: async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 50))
        return callCount
      },
    })
    const [a, b] = await Promise.all([runTask(task), runTask(task)])
    expect(callCount).toBe(1)
    expect(a).toBe(1)
    expect(b).toBe(1)
  })
})

// ── collectCronTasks ────────────────────────────────

describe('collectCronTasks', () => {
  it('finds cron tasks in router', () => {
    const cleanup = s.$task({ name: 'cleanup', cron: '0 9 * * *', resolve: async () => 'ok' })
    const sync = s.$task({ name: 'sync', cron: '*/5 * * * *', resolve: async () => 'ok' })
    const normal = s.$resolve(() => 'hello')

    const router = s.router({ health: normal, tasks: { cleanup, sync } })
    const crons = collectCronTasks(router)
    expect(crons).toHaveLength(2)
  })

  it('ignores tasks without cron', () => {
    const noCron = s.$task({ name: 'no-cron', resolve: async () => 'ok' })
    const router = s.router({ tasks: { noCron } })
    expect(collectCronTasks(router)).toHaveLength(0)
  })
})

// ── Context access ──────────────────────────────────

describe('task context', () => {
  it('receives base context on dispatch', async () => {
    const k = silgi({ context: () => ({ db: 'test-db', version: 42 }) })
    const task = k.$task({ name: 'ctx-test', resolve: async ({ ctx }) => ({ db: ctx.db, v: ctx.version }) })
    expect(await task.dispatch()).toEqual({ db: 'test-db', v: 42 })
  })

  it('with input + context', async () => {
    const k = silgi({ context: () => ({ secret: 'abc' }) })
    const task = k
      .$input(z.object({ userId: z.string() }))
      .$task({ name: 'ctx-input', resolve: async ({ input, ctx }) => `user:${input.userId} secret:${ctx.secret}` })
    expect(await task.dispatch({ userId: '123' })).toBe('user:123 secret:abc')
  })
})

// ── Analytics tracking ──────────────────────────────

describe('task analytics', () => {
  afterEach(() => setTaskAnalytics(null))

  it('calls analytics callback on success', async () => {
    const events: any[] = []
    setTaskAnalytics((e) => events.push(e))

    const task = s.$task({ name: 'test-task', resolve: async () => ({ ok: true }) })
    await task.dispatch()

    expect(events).toHaveLength(1)
    expect(events[0].taskName).toBe('test-task')
    expect(events[0].status).toBe('success')
  })

  it('calls analytics callback on error', async () => {
    const events: any[] = []
    setTaskAnalytics((e) => events.push(e))

    const task = s.$task({
      name: 'failing',
      resolve: async () => {
        throw new Error('boom')
      },
    })
    await expect(task.dispatch()).rejects.toThrow('boom')
    expect(events[0].status).toBe('error')
  })
})

// ── Type safety ─────────────────────────────────────

describe('type safety', () => {
  it('dispatch input typed from schema', () => {
    const task = s.$input(z.object({ to: z.string(), subject: z.string() })).$task({
      name: 'typed',
      resolve: async ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ to: string; subject: string }>()
        return { sent: true }
      },
    })
    expectTypeOf(task.dispatch).parameter(0).toEqualTypeOf<{ to: string; subject: string }>()
  })

  it('no-input dispatch is optional', () => {
    const task = s.$task({ name: 'opt', resolve: async () => 42 })
    expectTypeOf(task.dispatch).toBeCallableWith()
  })
})
