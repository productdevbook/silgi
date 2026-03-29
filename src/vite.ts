/**
 * Silgi Vite Plugin — auto-generates route metadata for client.
 *
 * Watches server route files and regenerates `routes.json` on change.
 * Uses `minifyContractRouter()` to extract only `{ path, method }`.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { silgiRoutes } from 'silgi/vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     silgiRoutes({ router: './server/router.ts', output: './src/lib/routes.json' }),
 *   ],
 * })
 * ```
 *
 * ```ts
 * // client.ts
 * import routes from './routes.json'
 * const link = createLink({ url: '...', routes })
 * ```
 */

// Use loose typing to avoid Vite version mismatch between silgi and consumer
type VitePlugin = { name: string; enforce?: string; configResolved?: Function; buildStart?: Function; configureServer?: Function; [key: string]: any }

export interface SilgiRoutesOptions {
  /** Path to the router file (relative to project root). @default './server/router.ts' */
  router?: string
  /** Export name of the router. @default 'appRouter' */
  exportName?: string
  /** Output path for routes.json. @default './src/lib/routes.json' */
  output?: string
  /** Directories to watch for changes. @default ['./server/rpc/routes'] */
  watch?: string[]
}

export function silgiRoutes(options: SilgiRoutesOptions = {}): any {
  const routerPath = options.router ?? './server/router.ts'
  const exportName = options.exportName ?? 'appRouter'
  const outputPath = options.output ?? './src/lib/routes.json'
  const watchDirs = options.watch ?? ['./server/rpc/routes']

  let root: string
  let generateTimeout: ReturnType<typeof setTimeout> | null = null

  async function generate() {
    try {
      const { resolve } = await import('node:path')
      const { writeFileSync } = await import('node:fs')
      const { createJiti } = await import('jiti')

      const jiti = createJiti(root, {
        interopDefault: true,
        moduleCache: false,
      })

      const routerModule = await jiti.import(resolve(root, routerPath)) as Record<string, unknown>
      const router = routerModule[exportName]
      if (!router) return

      const { minifyContractRouter } = await import('./contract.ts')
      const routes = minifyContractRouter(router)

      const out = resolve(root, outputPath)
      const json = JSON.stringify(routes, null, 2)

      // Only write if changed
      let existing = ''
      try {
        const { readFileSync } = await import('node:fs')
        existing = readFileSync(out, 'utf8')
      } catch {}

      if (existing !== json) {
        writeFileSync(out, json)
        console.log(`[silgi] Routes updated (${Object.keys(routes).length} top-level keys)`)
      }
    } catch (error: any) {
      console.warn(`[silgi] Failed to extract routes: ${error.message}`)
    }
  }

  function scheduleGenerate() {
    if (generateTimeout) clearTimeout(generateTimeout)
    generateTimeout = setTimeout(generate, 300) // debounce 300ms
  }

  return {
    name: 'silgi:routes',
    enforce: 'pre',

    configResolved(config) {
      root = config.root
    },

    async buildStart() {
      await generate()
    },

    configureServer(server) {
      const { resolve } = require('node:path')
      for (const dir of watchDirs) {
        const absDir = resolve(root, dir)
        server.watcher.add(absDir)
      }

      server.watcher.on('change', (file: string) => {
        const isRouteFile = watchDirs.some(dir => file.includes(dir.replace('./', '')))
        const isRouterFile = file.endsWith('router.ts')
        if (isRouteFile || isRouterFile) {
          scheduleGenerate()
        }
      })

      server.watcher.on('add', (file: string) => {
        const isRouteFile = watchDirs.some(dir => file.includes(dir.replace('./', '')))
        if (isRouteFile) scheduleGenerate()
      })
    },
  }
}
