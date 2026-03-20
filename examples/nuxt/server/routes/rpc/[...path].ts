import { defineHandler } from 'nitro/h3'
import { compileRouter, SilgiError } from 'silgi'

import { appRouter, contextFactory } from '../../rpc'

const compiledRouter = compileRouter(appRouter)

export default defineHandler(async (event) => {
  const procedurePath = event.context.params?.path || ''
  const method = event.method

  const match = compiledRouter(method, '/' + procedurePath)
  if (!match) {
    return { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }
  }

  const route = match.data

  // Build context from factory + route params
  const ctx: Record<string, unknown> = Object.create(null)
  const baseCtx = contextFactory()
  for (const k of Object.keys(baseCtx)) ctx[k] = (baseCtx as any)[k]
  if (match.params) ctx.params = match.params

  let input: unknown
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    input = await event.req.json().catch(() => undefined)
  } else {
    const data = event.url.searchParams.get('data')
    if (data) input = JSON.parse(data)
  }

  try {
    return await route.handler(ctx, input, new AbortController().signal)
  } catch (error: any) {
    if (error?.name === 'ValidationError') {
      return { code: 'BAD_REQUEST', status: 400, message: error.message }
    }
    if (error instanceof SilgiError) {
      return error.toJSON()
    }
    return { code: 'INTERNAL_ERROR', status: 500, message: error?.message || 'Unknown error' }
  }
})
