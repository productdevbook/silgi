import { s } from './server/rpc/instance'
import { appRouter } from './server/rpc/router'

export default {
  fetch: s.handler(appRouter, {
    scalar: true,
    analytics: true,
  }),
}
