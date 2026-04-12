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

// --- Coexisting with existing Nuxt/Nitro routes ---
//
// If your Nuxt app has its own server routes (GraphQL, API, etc.), silgi's handler
// will intercept ALL requests. To let unmatched routes fall through to Nuxt's
// normal routing, check for 404 and return undefined:
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
