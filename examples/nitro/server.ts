/**
 * Silgi + Nitro — modular integration.
 *
 * Export an object with a `fetch` method — Nitro uses it as the server.
 * Analytics dashboard at /analytics.
 */
import { s } from './server/rpc/instance'
import { appRouter } from './server/rpc/router'

export default {
  fetch: s.handler(appRouter, {
    scalar: true,
    analytics: {
      auth: 'test',
    },
  }),
}
