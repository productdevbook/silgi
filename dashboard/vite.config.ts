import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: '../lib/dashboard',
    emptyOutDir: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      '/analytics/_api': 'http://localhost:3000',
    },
  },
})
