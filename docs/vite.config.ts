import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import mdx from 'fumadocs-mdx/vite';
import { nitro } from 'nitro/vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tanstackStart({
      // prerender disabled due to fumadocs#3104 (tslib resolve bug)
      // re-enable when upstream fix lands
    }),
    react(),
    // please see https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro for guides on hosting
    nitro({
      serverDir: 'server',
      preset: 'cloudflare-pages',
      externals: {
        external: ['@takumi-rs/core'],
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    external: ['@takumi-rs/image-response'],
  },
});
