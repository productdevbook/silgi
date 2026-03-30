import { AsyncLocalStorage } from 'node:async_hooks'

const ctxStorage = new AsyncLocalStorage<Record<string, unknown>>()

export function runWithCtx<T>(ctx: Record<string, unknown>, fn: () => T): T {
  return ctxStorage.run(ctx, fn)
}

export function getCtx(): Record<string, unknown> | undefined {
  return ctxStorage.getStore()
}
