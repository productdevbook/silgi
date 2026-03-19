import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  compatibilityDate: '2025-01-01',
  serverDir: 'server',
  devServer: {
    port: 3456,
  },
})
