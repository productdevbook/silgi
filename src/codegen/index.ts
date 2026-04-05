/**
 * silgi/codegen — OpenAPI → Silgi code generator.
 *
 * Takes an OpenAPI 3.x spec and generates:
 * - Validation schemas (Zod, Valibot, or ArkType) for all components and operation I/O
 * - Co-located route modules (handlers + procedures in the same file, per domain)
 * - Root router that combines all route modules
 *
 * @example
 * ```ts
 * import { generateFromSpec } from 'silgi/codegen'
 *
 * await generateFromSpec({
 *   spec: './openapi.json',
 *   outDir: './src/generated',
 *   schema: 'zod', // or 'valibot' or 'arktype'
 * })
 * ```
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'

import { generateCode } from './generate.ts'
import { parseOpenAPI } from './parse.ts'

import type { GenerateOptions } from './generate.ts'
import type { OpenAPISpec } from './parse.ts'

// ── Public API ─────────────────────────────────────────

export interface GenerateFromSpecOptions extends GenerateOptions {
  /** Path to OpenAPI spec file (JSON or YAML) or a spec object */
  spec: string | OpenAPISpec
  /** Output directory for generated files (default: "./generated") */
  outDir?: string
  /**
   * What to do when route files already exist:
   * - "smart" (default) — regenerate $route/$input/$output/$errors, preserve $resolve body
   * - "skip" — don't touch existing route files at all
   * - "overwrite" — regenerate everything including $resolve
   */
  routeStrategy?: 'smart' | 'skip' | 'overwrite'
}

export interface GenerateResult {
  /** Paths of all generated files */
  files: string[]
  /** Number of operations processed */
  operationCount: number
  /** Number of component schemas generated */
  schemaCount: number
}

/**
 * Generate Silgi code from an OpenAPI spec file or object.
 */
export async function generateFromSpec(options: GenerateFromSpecOptions): Promise<GenerateResult> {
  const { outDir = './generated', routeStrategy = 'smart', ...genOpts } = options

  const spec = typeof options.spec === 'string' ? await loadSpec(options.spec) : options.spec
  const { operations, components, tags: _tags } = parseOpenAPI(spec)
  const { schemas, router, routes } = generateCode(operations, components, genOpts)

  const outputDir = resolve(outDir)
  await mkdir(outputDir, { recursive: true })

  const files: string[] = []

  // schemas.gen.ts
  const schemasPath = join(outputDir, 'schemas.gen.ts')
  await writeFile(schemasPath, schemas, 'utf-8')
  files.push(schemasPath)

  // router.gen.ts
  const routerPath = join(outputDir, 'router.gen.ts')
  await writeFile(routerPath, router, 'utf-8')
  files.push(routerPath)

  // routes/<group>/<operationId>.ts
  if (routes.size > 0) {
    const { extractResolveBody, spliceResolveBody } = await import('./preserve.ts')

    for (const [filePath, code] of routes) {
      const fullPath = join(outputDir, 'routes', `${filePath}.ts`)
      const dir = join(fullPath, '..')
      await mkdir(dir, { recursive: true })

      if (routeStrategy === 'skip') {
        if (await fileExists(fullPath)) continue
      }

      if (routeStrategy === 'smart' && (await fileExists(fullPath))) {
        // Preserve developer's $resolve body, regenerate everything else
        const existing = await readFile(fullPath, 'utf-8')
        const preserved = extractResolveBody(existing)
        if (preserved) {
          await writeFile(fullPath, spliceResolveBody(code, preserved), 'utf-8')
        } else {
          // Stub or unparseable — overwrite with fresh generated code
          await writeFile(fullPath, code, 'utf-8')
        }
        files.push(fullPath)
        continue
      }

      await writeFile(fullPath, code, 'utf-8')
      files.push(fullPath)
    }
  }

  const schemaCount = (schemas.match(/^export const \w+Schema/gm) ?? []).length

  return { files, operationCount: operations.length, schemaCount }
}

/**
 * Generate Silgi code without writing to disk.
 * Useful for programmatic use or custom output handling.
 */
export function generate(
  spec: OpenAPISpec,
  options: GenerateOptions = {},
): {
  schemas: string
  router: string
  routes: Map<string, string>
  operations: ReturnType<typeof parseOpenAPI>['operations']
} {
  const { operations, components } = parseOpenAPI(spec)
  const result = generateCode(operations, components, options)
  return { ...result, operations }
}

// ── Re-exports ─────────────────────────────────────────

export { parseOpenAPI } from './parse.ts'
export type { OpenAPISpec, ParsedOperation } from './parse.ts'
export { generateCode } from './generate.ts'
export type { GenerateOptions } from './generate.ts'
export { jsonSchemaToCode } from './schema-to-code.ts'
export { createSchemaContext } from './schema-to-code.ts'
export type { SchemaContext } from './schema-to-code.ts'
export { getEmitter } from './emitters.ts'
export type { SchemaTarget, SchemaEmitter } from './emitters.ts'
export { extractResolveBody, spliceResolveBody } from './preserve.ts'

// ── Internal Helpers ───────────────────────────────────

async function loadSpec(path: string): Promise<OpenAPISpec> {
  const resolved = resolve(path)
  const content = await readFile(resolved, 'utf-8')
  const ext = extname(resolved).toLowerCase()

  if (ext === '.yaml' || ext === '.yml') {
    try {
      // @ts-ignore -- yaml is an optional dependency
      const { parse } = await import('yaml')
      return parse(content) as OpenAPISpec
    } catch {
      throw new Error('YAML spec detected but "yaml" package is not installed. Install it with: pnpm add -D yaml')
    }
  }

  return JSON.parse(content) as OpenAPISpec
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(path)
    return true
  } catch {
    return false
  }
}
