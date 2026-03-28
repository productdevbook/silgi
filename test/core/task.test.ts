import { describe, it, expect, expectTypeOf, afterEach } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'
import { defineTask, runTask, collectCronTasks, setTaskAnalytics } from '#src/core/task.ts'

import type { TaskDef } from '#src/core/task.ts'

const s = silgi({ context: () => ({}) })

// ── defineTask ──────────────────────────────────────

describe('defineTask', () => {
  it('no-input task', async () => {
    const task = defineTask(async () => ({ count: 42 }))
    expect(task._tag).toBe('task')
    expect(task.type).toBe('mutation')
    expect(await task.dispatch()).toEqual({ count: 42 })
  })

  it('with input schema', async () => {
    const task = defineTask(
      z.object({ name: z.string() }),
      async ({ input }) => `hello ${input.name}`,
    )
    expect(await task.dispatch({ name: 'world' })).toBe('hello world')
  })

  it('validates input', async () => {
    const task = defineTask(
      z.object({ count: z.number() }),
      async ({ input }) => input.count * 2,
    )
    await expect(task.dispatch({ count: 'bad' } as any)).rejects.toThrow()
  })

  it('with config object (cron + meta)', async () => {
    const task = defineTask({
      cron: '0 9 * * *',
      name: 'cleanup',
      description: 'Clean old records',
      resolve: async () => ({ deleted: 5 }),
    })
    expect(task.cron).toBe('0 9 * * *')
    expect(task.route?.summary).toBe('Clean old records')
    expect(await task.dispatch()).toEqual({ deleted: 5 })
  })

  it('with schema + config', async () => {
    const task = defineTask(
      z.object({ id: z.number() }),
      {
        description: 'Process item',
        resolve: async ({ input }) => ({ processed: input.id }),
      },
    )
    expect(task.route?.summary).toBe('Process item')
    expect(await task.dispatch({ id: 5 })).toEqual({ processed: 5 })
  })
})

// ── s.task() shorthand ──────────────────────────────

describe('s.task()', () => {
  it('no-input', async () => {
    const task = s.task(async () => 'done')
    expect(task._tag).toBe('task')
    expect(await task.dispatch()).toBe('done')
  })

  it('with schema', async () => {
    const task = s.task(
      z.object({ email: z.string().email() }),
      async ({ input }) => ({ sent: true, to: input.email }),
    )
    expect(await task.dispatch({ email: 'test@test.com' })).toEqual({ sent: true, to: 'test@test.com' })
  })

  it('with cron config', () => {
    const task = s.task({
      cron: '*/5 * * * *',
      resolve: async () => 'synced',
    })
    expect(task.cron).toBe('*/5 * * * *')
  })
})

// ── Direct router mount ─────────────────────────────

describe('router mount', () => {
  it('task mounts directly on router', () => {
    const sendEmail = defineTask(
      z.object({ to: z.string() }),
      async ({ input }) => ({ sent: true }),
    )

    const router = s.router({
      tasks: { sendEmail },
    })

    expect(router.tasks.sendEmail._tag).toBe('task')
    expect(router.tasks.sendEmail.type).toBe('mutation')
  })

  it('mixed procedures and tasks in router', () => {
    const cleanup = s.task(async () => 'cleaned')
    const list = s.$resolve(() => [1, 2, 3])

    const router = s.router({
      items: { list },
      tasks: { cleanup },
    })

    expect(router.items.list.type).toBe('query')
    expect(router.tasks.cleanup._tag).toBe('task')
  })
})

// ── runTask — singleton dedup ───────────────────────

describe('runTask', () => {
  it('returns result', async () => {
    const task = defineTask(async () => 42)
    expect(await runTask(task)).toBe(42)
  })

  it('deduplicates concurrent runs', async () => {
    let callCount = 0
    const task = defineTask(async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 50))
      return callCount
    })

    const [a, b] = await Promise.all([runTask(task), runTask(task)])
    expect(callCount).toBe(1)
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it('allows sequential runs', async () => {
    let callCount = 0
    const task = defineTask(async () => ++callCount)
    await runTask(task)
    await runTask(task)
    expect(callCount).toBe(2)
  })
})

// ── collectCronTasks ────────────────────────────────

describe('collectCronTasks', () => {
  it('finds cron tasks in flat router', () => {
    const cleanup = defineTask({ cron: '0 9 * * *', resolve: async () => 'ok' })
    const sync = defineTask({ cron: '*/5 * * * *', resolve: async () => 'ok' })
    const normal = s.$resolve(() => 'hello')

    const router = s.router({
      health: normal,
      tasks: { cleanup, sync },
    })

    const crons = collectCronTasks(router)
    expect(crons).toHaveLength(2)
    expect(crons[0]!.cron).toBe('0 9 * * *')
    expect(crons[1]!.cron).toBe('*/5 * * * *')
  })

  it('finds cron tasks in nested router', () => {
    const deep = defineTask({ cron: '0 0 * * *', resolve: async () => 'ok' })
    const router = s.router({
      a: { b: { deep } },
    })

    const crons = collectCronTasks(router)
    expect(crons).toHaveLength(1)
    expect(crons[0]!.cron).toBe('0 0 * * *')
  })

  it('ignores tasks without cron', () => {
    const noCron = defineTask(async () => 'ok')
    const router = s.router({ tasks: { noCron } })
    expect(collectCronTasks(router)).toHaveLength(0)
  })
})

// ── Context access ──────────────────────────────────

describe('task context', () => {
  it('s.task() receives base context on dispatch', async () => {
    const k = silgi({ context: () => ({ db: 'test-db', version: 42 }) })

    const task = k.task(async ({ ctx }) => {
      return { db: ctx.db, v: ctx.version }
    })

    const result = await task.dispatch()
    expect(result).toEqual({ db: 'test-db', v: 42 })
  })

  it('s.task() with input + context', async () => {
    const k = silgi({ context: () => ({ secret: 'abc' }) })

    const task = k.task(
      z.object({ userId: z.string() }),
      async ({ input, ctx }) => {
        return `user:${input.userId} secret:${ctx.secret}`
      },
    )

    const result = await task.dispatch({ userId: '123' })
    expect(result).toBe('user:123 secret:abc')
  })

  it('standalone defineTask gets minimal context', async () => {
    const task = defineTask(async ({ ctx }) => {
      // Standalone tasks get empty ctx (plus __analyticsTrace if analytics loaded)
      const keys = Object.keys(ctx).filter((k) => !k.startsWith('__'))
      return keys
    })

    const result = await task.dispatch()
    expect(result).toEqual([])
  })
})

// ── Analytics tracking ──────────────────────────────

describe('task analytics', () => {
  afterEach(() => setTaskAnalytics(null))

  it('calls analytics callback on success', async () => {
    const events: any[] = []
    setTaskAnalytics((e) => events.push(e))

    const task = defineTask({
      name: 'test-task',
      resolve: async () => ({ ok: true }),
    })

    await task.dispatch()

    expect(events).toHaveLength(1)
    expect(events[0].taskName).toBe('test-task')
    expect(events[0].trigger).toBe('dispatch')
    expect(events[0].status).toBe('success')
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(events[0].output).toEqual({ ok: true })
  })

  it('calls analytics callback on error', async () => {
    const events: any[] = []
    setTaskAnalytics((e) => events.push(e))

    const task = defineTask({
      name: 'failing-task',
      resolve: async () => { throw new Error('boom') },
    })

    await expect(task.dispatch()).rejects.toThrow('boom')

    expect(events).toHaveLength(1)
    expect(events[0].status).toBe('error')
    expect(events[0].error).toBe('boom')
  })

  it('no callback when analytics not set', async () => {
    const task = defineTask(async () => 'ok')
    // Should not throw even without analytics
    await expect(task.dispatch()).resolves.toBe('ok')
  })
})

// ── Type safety ─────────────────────────────────────

describe('type safety', () => {
  it('dispatch input typed from schema', () => {
    const task = defineTask(
      z.object({ to: z.string(), subject: z.string() }),
      async ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ to: string; subject: string }>()
        return { sent: true }
      },
    )
    expectTypeOf(task.dispatch).parameter(0).toEqualTypeOf<{ to: string; subject: string }>()
    expectTypeOf(task.dispatch).returns.resolves.toEqualTypeOf<{ sent: true }>()
  })

  it('no-input dispatch is optional', () => {
    const task = defineTask(async () => 42)
    expectTypeOf(task.dispatch).toBeCallableWith()
  })

  it('s.task() matches defineTask types', () => {
    const task = s.task(
      z.object({ id: z.number() }),
      async ({ input }) => ({ found: input.id > 0 }),
    )
    expectTypeOf(task).toMatchTypeOf<TaskDef<{ id: number }, { found: boolean }>>()
  })

  it('s.task() ctx is typed as TBaseCtx', () => {
    const k = silgi({ context: () => ({ db: 'pg', count: 0 }) })

    k.task(async ({ ctx }) => {
      expectTypeOf(ctx.db).toBeString()
      expectTypeOf(ctx.count).toBeNumber()
      return true
    })

    k.task(
      z.object({ id: z.number() }),
      async ({ input, ctx }) => {
        expectTypeOf(input).toEqualTypeOf<{ id: number }>()
        expectTypeOf(ctx.db).toBeString()
        return true
      },
    )
  })
})
