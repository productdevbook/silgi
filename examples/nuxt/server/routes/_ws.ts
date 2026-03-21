import { createWSHooks } from 'silgi/ws'

import { appRouter } from '../rpc/router'

// @ts-expect-error — Nitro auto-import
export default defineWebSocketHandler(createWSHooks(appRouter))
