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

// --- Coexisting with existing Nitro routes ---
//
// If your Nitro app already has its own routes (GraphQL, API, file-system routes, etc.),
// silgi's handler will intercept ALL requests. To let unmatched routes fall through to
// Nitro's normal routing, check for 404 and return undefined:
//
// const silgiHandler = s.handler(appRouter)
//
// export default {
//   fetch: async (request: Request) => {
//     const response = await silgiHandler(request)
//     if (response.status === 404) return
//     return response
//   },
// }
