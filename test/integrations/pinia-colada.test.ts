import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

import { createGeneralUtils } from '#src/integrations/pinia-colada/general-utils.ts'
import * as generalUtilsModule from '#src/integrations/pinia-colada/general-utils.ts'
import * as keyModule from '#src/integrations/pinia-colada/key.ts'
import { buildKey } from '#src/integrations/pinia-colada/key.ts'
import { createProcedureUtils } from '#src/integrations/pinia-colada/procedure-utils.ts'
import * as procedureUtilsModule from '#src/integrations/pinia-colada/procedure-utils.ts'
import { createRouterUtils } from '#src/integrations/pinia-colada/router-utils.ts'

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
