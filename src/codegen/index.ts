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

import type { OpenAPISpec } from './parse.ts'
import { parseOpenAPI } from './parse.ts'
import { type GenerateOptions, generateCode } from './generate.ts'

// ── Public API ─────────────────────────────────────────

export interface GenerateFromSpecOptions extends GenerateOptions {
  /** Path to OpenAPI spec file (JSON or YAML) or a spec object */
  spec: string | OpenAPISpec
  /** Output directory for generated files (default: "./generated") */
  outDir?: string
  /**
   * What to do when route files already exist:
   * - "skip" (default) — don't overwrite existing route files
   * - "overwrite" — regenerate route files
   * - "merge" — only add missing handler functions
   */
  routeStrategy?: 'skip' | 'overwrite' | 'merge'
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
  const { outDir = './generated', routeStrategy = 'skip', ...genOpts } = options

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
    for (const [filePath, code] of routes) {
      // filePath is "group/operationId"
      const fullPath = join(outputDir, 'routes', `${filePath}.ts`)
      const dir = join(fullPath, '..')
      await mkdir(dir, { recursive: true })

      if (routeStrategy === 'skip') {
        if (await fileExists(fullPath)) continue
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

// ── Internal Helpers ───────────────────────────────────

async function loadSpec(path: string): Promise<OpenAPISpec> {
  const resolved = resolve(path)
  const content = await readFile(resolved, 'utf-8')
  const ext = extname(resolved).toLowerCase()

  if (ext === '.yaml' || ext === '.yml') {
    try {
      const { parse } = await import('yaml')
      return parse(content) as OpenAPISpec
    } catch {
      throw new Error(
        'YAML spec detected but "yaml" package is not installed. Install it with: pnpm add -D yaml',
      )
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

/**
 * Merge new handler stubs into an existing route file.
 * Only adds functions that don't already exist.
 */
async function mergeRouteModule(existingPath: string, newCode: string): Promise<string> {
  const existing = await readFile(existingPath, 'utf-8')

  const existingFns = new Set<string>()
  const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g
  let match
  while ((match = fnRegex.exec(existing)) !== null) {
    existingFns.add(match[1]!)
  }

  const newFns: string[] = []
  const newFnRegex = /(?:\/\*\*[^]*?\*\/\n)?(?:async\s+)?function\s+(\w+)[^]*?^\}/gm
  while ((match = newFnRegex.exec(newCode)) !== null) {
    if (!existingFns.has(match[1]!)) {
      newFns.push(match[0]!)
    }
  }

  if (newFns.length === 0) return existing

  return existing.trimEnd() + '\n\n' + newFns.join('\n\n') + '\n'
}
