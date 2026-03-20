import { H3 } from 'h3'
import { silgiH3 } from 'silgi/h3'

import { appRouter, contextFactory } from './rpc.ts'

const app = new H3()

app.all('/rpc/**', silgiH3(appRouter, { context: contextFactory }))

export default app
