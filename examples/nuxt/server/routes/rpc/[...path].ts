import { defineHandler } from 'nitro/h3'
import { silgiH3 } from 'silgi/h3'

import { appRouter, contextFactory } from '../../rpc'

export default defineHandler(silgiH3(appRouter, { context: contextFactory }))
