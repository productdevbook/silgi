export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  modules: ['@nuxtjs/tailwindcss'],
  nitro: {
    features: { websocket: true },
  },
  vite: {
    optimizeDeps: {
      include: ['msgpackr'],
    },
  },
})
