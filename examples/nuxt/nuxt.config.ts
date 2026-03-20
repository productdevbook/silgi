export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  modules: ['@nuxtjs/tailwindcss'],
  vite: {
    optimizeDeps: {
      include: ['msgpackr'],
    },
  },
})
