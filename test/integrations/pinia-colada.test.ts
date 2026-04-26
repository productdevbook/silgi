import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

import { createGeneralUtils } from '#src/integrations/pinia-colada/general-utils.ts'
import * as generalUtilsModule from '#src/integrations/pinia-colada/general-utils.ts'
import * as keyModule from '#src/integrations/pinia-colada/key.ts'
import { buildKey } from '#src/integrations/pinia-colada/key.ts'
import { createProcedureUtils } from '#src/integrations/pinia-colada/procedure-utils.ts'
import * as procedureUtilsModule from '#src/integrations/pinia-colada/procedure-utils.ts'
import { createRouterUtils } from '#src/integrations/pinia-colada/router-utils.ts'
import { silgi } from '#src/silgi.ts'

// === buildKey ===

describe('buildKey', () => {
  it('works', () => {
    expect(buildKey(['path'])).toEqual([['path'], {}])
    expect(buildKey(['path', 'path2'], { input: { a: 1 } })).toEqual([['path', 'path2'], { input: { a: 1 } }])
    expect(buildKey(['path'], { input: undefined })).toEqual([['path'], {}])
    expect(buildKey(['path', 'path2'], { type: 'query' })).toEqual([['path', 'path2'], { type: 'query' }])
    expect(buildKey(['path'], { type: undefined })).toEqual([['path'], {}])
    expect(buildKey(['path', 'path2'], { type: 'query', input: { a: 1 } })).toEqual([
      ['path', 'path2'],
      { type: 'query', input: { a: 1 } },
    ])
  })
})

// === createGeneralUtils ===

describe('createGeneralUtils', () => {
  const buildKeySpy = vi.spyOn(keyModule, 'buildKey')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const utils = createGeneralUtils(['path'])

  it('.key', () => {
    expect(utils.key({ input: { search: '__search__' } })).toEqual(buildKeySpy.mock.results[0]!.value)

    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith(['path'], { input: { search: '__search__' } })
  })
})

// === createProcedureUtils ===

describe('createProcedureUtils', () => {
  const buildKeySpy = vi.spyOn(keyModule, 'buildKey')
  const controller = new AbortController()
  const signal = controller.signal

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('.call', () => {
    const client = vi.fn((...[input]: any[]) => Promise.resolve(input?.toString()))
    const utils = createProcedureUtils(client as any, { path: ['ping'] })

    expect(utils.call).toBe(client)
  })

  describe('queryOptions', () => {
    const client = vi.fn((...[input]: any[]) => Promise.resolve(input?.toString()))
    const utils = createProcedureUtils(client as any, { path: ['ping'] })

    beforeEach(() => {
      client.mockClear()
    })

    it('works', async () => {
      const options = utils.queryOptions({ input: 1 }) as any

      expect(options.key.value).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { input: 1, type: 'query' })

      client.mockResolvedValueOnce('__mocked__')
      await expect((options as any).query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith(1, { signal })
    })

    it('works with ref', async () => {
      const input = ref(1)
      const options = utils.queryOptions({ input }) as any

      expect(options.key.value).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { input: 1, type: 'query' })

      client.mockResolvedValueOnce('__mocked__')
      await expect((options as any).query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith(1, { signal })
    })

    it('works with client context', async () => {
      const client = vi.fn((...[input]: any[]) => Promise.resolve(input?.toString()))
      const utils = createProcedureUtils(client as any, { path: ['ping'] })

      const options = utils.queryOptions({ context: ref({ batch: true }) }) as any

      expect(options.key.value).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query' })

      client.mockResolvedValueOnce('__mocked__')
      await expect((options as any).query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith(undefined, { signal, context: { batch: true } })
    })
  })

  describe('mutationOptions', () => {
    const client = vi.fn((...[input]: any[]) => Promise.resolve(input?.toString()))
    const utils = createProcedureUtils(client as any, { path: ['ping'] })

    beforeEach(() => {
      client.mockClear()
    })

    it('works', async () => {
      const options = utils.mutationOptions() as any

      expect(options.key('__input__')).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { input: '__input__', type: 'mutation' })

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.mutation(1)).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith(1, {})
    })

    it('works with client context', async () => {
      const client = vi.fn((...[input]: any[]) => Promise.resolve(input?.toString()))
      const utils = createProcedureUtils(client as any, { path: ['ping'] })

      const options = utils.mutationOptions({ context: ref({ batch: true }) }) as any

      expect(options.key('__input__')).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { input: '__input__', type: 'mutation' })

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.mutation(1)).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith(1, { context: { batch: true } })
    })
  })
})

// === createRouterUtils ===

describe('createRouterUtils', () => {
  const procedureUtilsSpy = vi.spyOn(procedureUtilsModule, 'createProcedureUtils')
  const generalUtilsSpy = vi.spyOn(generalUtilsModule, 'createGeneralUtils')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const client = vi.fn() as any
  client.key = vi.fn()
  client.key.pong = vi.fn()

  it('works', () => {
    const utils = createRouterUtils(client, {
      path: ['__base__'],
    }) as any

    expect(generalUtilsSpy).toHaveBeenCalledTimes(1)
    expect(generalUtilsSpy).toHaveBeenCalledWith(['__base__'])
    expect(procedureUtilsSpy).toHaveBeenCalledTimes(1)
    expect(procedureUtilsSpy).toHaveBeenCalledWith(client, { path: ['__base__'] })

    expect(utils.key()).toEqual(generalUtilsSpy.mock.results[0]!.value.key())
    expect(utils.queryOptions().key.value).toEqual(procedureUtilsSpy.mock.results[0]!.value.queryOptions().key.value)

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(generalUtilsSpy).toHaveBeenCalledTimes(1)
    expect(generalUtilsSpy).toHaveBeenCalledWith(['__base__', 'key'])
    expect(procedureUtilsSpy).toHaveBeenCalledTimes(1)
    expect(procedureUtilsSpy).toHaveBeenCalledWith(client.key, { path: ['__base__', 'key'] })

    expect(keyUtils.key()).toEqual(generalUtilsSpy.mock.results[0]!.value.key())
    expect(keyUtils.queryOptions().key.value).toEqual(procedureUtilsSpy.mock.results[0]!.value.queryOptions().key.value)

    vi.clearAllMocks()
    const pongUtils = utils.key.pong

    expect(generalUtilsSpy).toHaveBeenCalledTimes(2)
    expect(generalUtilsSpy).toHaveBeenNthCalledWith(1, ['__base__', 'key'])
    expect(generalUtilsSpy).toHaveBeenNthCalledWith(2, ['__base__', 'key', 'pong'])

    expect(procedureUtilsSpy).toHaveBeenCalledTimes(2)
    expect(procedureUtilsSpy).toHaveBeenNthCalledWith(1, client.key, { path: ['__base__', 'key'] })
    expect(procedureUtilsSpy).toHaveBeenNthCalledWith(2, client.key.pong, { path: ['__base__', 'key', 'pong'] })

    expect(pongUtils.key()).toEqual(generalUtilsSpy.mock.results[1]!.value.key())
    expect(pongUtils.queryOptions().key.value).toEqual(
      procedureUtilsSpy.mock.results[1]!.value.queryOptions().key.value,
    )
  })

  it('not recursive on symbol', async () => {
    const utils = createRouterUtils(client, {
      path: ['__base__'],
    }) as any

    expect(utils[Symbol.for('a')]).toBe(undefined)
  })
})

// === Type Inference Protection ===

import { z } from 'zod'

import type { Client } from '#src/client/types.ts'
import type { SilgiError } from '#src/core/error.ts'
import type { ProcedureUtils } from '#src/integrations/pinia-colada/procedure-utils.ts'
import type { RouterUtils } from '#src/integrations/pinia-colada/router-utils.ts'
import type { QueryOptionsIn, MutationOptionsIn } from '#src/integrations/pinia-colada/types.ts'
import type { InferClient } from '#src/types.ts'
import type { UseQueryOptions, UseMutationOptions, EntryKey } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'

const k = silgi({
  context: () => ({ db: { users: [] as { id: number; name: string }[] } }),
})

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' as const })),
  users: {
    list: k.$input(z.object({ limit: z.number().optional() })).$resolve(({ ctx }) => ctx.db.users),
    get: k.$input(z.object({ id: z.number() })).$resolve(({ input, ctx }) => {
      return ctx.db.users.find((u) => u.id === input.id)!
    }),
    create: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ id: 1, name: input.name })),
  },
})

type AppClient = InferClient<typeof appRouter>

describe('pinia-colada type inference', () => {
  it('RouterUtils maps client tree correctly', () => {
    type Utils = RouterUtils<AppClient>

    // Root level has .key() from GeneralUtils
    expectTypeOf<Utils['key']>().toBeFunction()

    // Namespace level has both GeneralUtils and child access
    expectTypeOf<Utils['users']['key']>().toBeFunction()

    // Leaf level has ProcedureUtils
    expectTypeOf<Utils['users']['list']>().toHaveProperty('queryOptions')
    expectTypeOf<Utils['users']['list']>().toHaveProperty('mutationOptions')
    expectTypeOf<Utils['users']['list']>().toHaveProperty('call')
    expectTypeOf<Utils['users']['list']>().toHaveProperty('key')
  })

  it('ProcedureUtils preserves input/output types', () => {
    type ListUtils = RouterUtils<AppClient>['users']['list']

    // call should match the Client signature
    expectTypeOf<ListUtils['call']>().toMatchTypeOf<
      Client<{}, { limit?: number | undefined }, { id: number; name: string }[], SilgiError>
    >()
  })

  it('QueryOptionsIn requires input when not optional', () => {
    // Required input: input field is mandatory
    type WithInput = QueryOptionsIn<{}, { id: number }, string, SilgiError, undefined>
    expectTypeOf<WithInput>().toHaveProperty('input')

    // Optional input: input field is optional
    type WithoutInput = QueryOptionsIn<{}, undefined, string, SilgiError, undefined>
    expectTypeOf<WithoutInput>().toHaveProperty('input')
  })

  it('QueryOptionsIn context optionality based on ClientContext', () => {
    // Empty context: context is optional
    type EmptyCtx = QueryOptionsIn<{}, undefined, string, SilgiError, undefined>
    expectTypeOf<EmptyCtx>().toHaveProperty('context')

    // Non-empty context: context is required
    type WithCtx = QueryOptionsIn<{ token: string }, undefined, string, SilgiError, undefined>
    expectTypeOf<WithCtx>().toHaveProperty('context')
  })

  it('QueryOptionsIn accepts MaybeRefOrGetter for input', () => {
    type Opts = QueryOptionsIn<{}, { id: number }, string, SilgiError, undefined>

    // input should accept MaybeRefOrGetter<{ id: number }>
    expectTypeOf<Opts['input']>().toEqualTypeOf<MaybeRefOrGetter<{ id: number }>>()
  })

  it('MutationOptionsIn preserves types', () => {
    type Opts = MutationOptionsIn<{}, { name: string }, { id: number }, SilgiError, Record<any, any>>

    // Should extend UseMutationOptions shape
    expectTypeOf<Opts>().toHaveProperty('mutation')
  })

  it('RouterUtils recursion preserves deep nesting', () => {
    type DeepClient = {
      a: {
        b: {
          c: Client<{}, { x: number }, { y: string }, SilgiError>
        }
      }
    }

    type Utils = RouterUtils<DeepClient>

    // Deep leaf should have ProcedureUtils
    expectTypeOf<Utils['a']['b']['c']>().toHaveProperty('queryOptions')
    expectTypeOf<Utils['a']['b']['c']>().toHaveProperty('call')

    // Intermediate levels should have GeneralUtils
    expectTypeOf<Utils['a']['key']>().toBeFunction()
    expectTypeOf<Utils['a']['b']['key']>().toBeFunction()
  })

  it('GeneralUtils.key returns EntryKey', () => {
    type Utils = RouterUtils<AppClient>

    expectTypeOf<ReturnType<Utils['key']>>().toEqualTypeOf<EntryKey>()
    expectTypeOf<ReturnType<Utils['users']['key']>>().toEqualTypeOf<EntryKey>()
  })

  // Regression: https://github.com/productdevbook/silgi/issues/29
  // A subscription procedure used to be inferred as `() => AsyncIterableIterator<T>`
  // which doesn't satisfy `SubscriptionClient` (which expects `Promise<AsyncIterableIterator<T>>`),
  // collapsing `T extends NestedClient` and producing a union of three RouterUtils arms.
  it('RouterUtils accepts routers containing subscription procedures', () => {
    const subRouter = k.router({
      api: {
        chat: k.subscription(z.object({ message: z.string() }), async function* ({ input }) {
          yield { type: 'text-delta' as const, delta: input.message }
          yield { type: 'done' as const }
        }),
        health: k.$resolve(() => ({ status: 'ok' as const })),
      },
    })

    type SubClient = InferClient<typeof subRouter>
    type Utils = RouterUtils<SubClient>

    expectTypeOf<Utils['key']>().toBeFunction()
    expectTypeOf<Utils['api']['key']>().toBeFunction()
    expectTypeOf<Utils['api']['chat']>().toHaveProperty('queryOptions')
    expectTypeOf<Utils['api']['health']>().toHaveProperty('queryOptions')
  })
})
