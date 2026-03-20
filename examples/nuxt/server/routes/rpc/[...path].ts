import { defineHandler } from 'nitro/h3'
import { compileRouter } from 'silgi/compile'

import { appRouter } from '../../rpc'

const compiledRouter = compileRouter(appRouter)

export default defineHandler(async (event) => {
  const procedurePath = event.context.params?.path || ''
  const method = event.method

  const match = compiledRouter(method, '/' + procedurePath)
  if (!match) {
    return { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }
  }

  const route = match.data
  const ctx: Record<string, unknown> = Object.create(null)
  if (match.params) ctx.params = match.params

  let input: unknown
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    input = await event.req.json().catch(() => undefined)
  } else {
    const data = event.url.searchParams.get('data')
    if (data) input = JSON.parse(data)
  }

  const output = await route.handler(ctx, input, new AbortController().signal)
  return output
})
