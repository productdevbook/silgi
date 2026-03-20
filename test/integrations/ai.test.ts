/**
 * AI SDK integration tests — procedure → tool conversion.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { procedureToTool, routerToTools } from '#src/integrations/ai/index.ts'
import { katman } from '#src/katman.ts'

const k = katman({ context: () => ({}) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  users: {
    list: k.$input(z.object({ limit: z.number().optional() })).$resolve(({ input }) => ({
      users: [{ id: 1, name: 'Alice' }].slice(0, input.limit ?? 10),
    })),
    create: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ id: 2, name: input.name })),
  },
})

describe('procedureToTool', () => {
  it('converts a procedure to an AI tool', () => {
    const t = procedureToTool('echo', appRouter.echo as any)
    expect(t.description).toBeTruthy()
    expect(t.parameters).toBeTruthy()
    expect(typeof t.execute).toBe('function')
  })

  it('tool execute calls the procedure', async () => {
    const t = procedureToTool('echo', appRouter.echo as any)
    const result = await t.execute!(
      { msg: 'ai test' },
      { toolCallId: '1', messages: [], abortSignal: AbortSignal.timeout(5000) },
    )
    expect((result as any).echo).toBe('ai test')
  })

  it('no-input procedure works', async () => {
    const t = procedureToTool('health', appRouter.health as any)
    const result = await t.execute!({}, { toolCallId: '1', messages: [], abortSignal: AbortSignal.timeout(5000) })
    expect((result as any).status).toBe('ok')
  })

  it('extracts JSON Schema from Zod input', () => {
    const t = procedureToTool('echo', appRouter.echo as any)
    expect(t.parameters).toBeTruthy()
    // jsonSchema wrapper contains the schema
    const schema = (t.parameters as any).jsonSchema ?? t.parameters
    expect(schema.type).toBe('object')
  })
})

describe('routerToTools', () => {
  it('converts router to flat tool map', () => {
    const tools = routerToTools(appRouter)
    expect(Object.keys(tools)).toContain('health')
    expect(Object.keys(tools)).toContain('echo')
    expect(Object.keys(tools)).toContain('users_list')
    expect(Object.keys(tools)).toContain('users_create')
  })

  it('all tools are executable', async () => {
    const tools = routerToTools(appRouter)
    const opts = { toolCallId: '1', messages: [] as any, abortSignal: AbortSignal.timeout(5000) }

    const health = await tools.health!.execute!({}, opts)
    expect((health as any).status).toBe('ok')

    const echo = await tools.echo!.execute!({ msg: 'test' }, opts)
    expect((echo as any).echo).toBe('test')

    const users = await tools.users_list!.execute!({ limit: 1 }, opts)
    expect((users as any).users).toHaveLength(1)
  })

  it('filter option excludes procedures', () => {
    const tools = routerToTools(appRouter, {
      filter: (path) => !path.startsWith('users_'),
    })
    expect(Object.keys(tools)).toContain('health')
    expect(Object.keys(tools)).not.toContain('users_list')
  })

  it('custom descriptions', () => {
    const tools = routerToTools(appRouter, {
      descriptions: { health: 'Check system health' },
    })
    expect(tools.health!.description).toBe('Check system health')
  })
})
