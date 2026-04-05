/**
 * silgi/codegen — OpenAPI → Silgi code generator.
 *
 * Takes an OpenAPI 3.x spec and generates:
 * - Validation schemas (Zod, Valibot, or ArkType) for all components and operation I/O
 * - Silgi router with typed procedures
 * - Handler stubs ready to implement
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
   * What to do when handler files already exist:
   * - "skip" (default) — don't overwrite existing handlers
   * - "overwrite" — regenerate handler stubs
   * - "merge" — only add missing handler functions
   */
  handlerStrategy?: 'skip' | 'overwrite' | 'merge'
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
  const { outDir = './generated', handlerStrategy = 'skip', ...genOpts } = options

  // Load spec
  const spec = typeof options.spec === 'string' ? await loadSpec(options.spec) : options.spec

  // Parse
  const { operations, components, tags: _tags } = parseOpenAPI(spec)

  // Generate code
  const { schemas, router, handlers } = generateCode(operations, components, genOpts)

  // Write files
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

  // handlers/
  if (handlers.size > 0) {
    const handlersDir = join(outputDir, 'handlers')
    await mkdir(handlersDir, { recursive: true })

    for (const [name, code] of handlers) {
      const handlerPath = join(handlersDir, `${name}.ts`)

      if (handlerStrategy === 'skip') {
        const exists = await fileExists(handlerPath)
        if (exists) continue
      } else if (handlerStrategy === 'merge') {
        const exists = await fileExists(handlerPath)
        if (exists) {
          const merged = await mergeHandlerStub(handlerPath, code)
          await writeFile(handlerPath, merged, 'utf-8')
          files.push(handlerPath)
          continue
        }
      }

      await writeFile(handlerPath, code, 'utf-8')
      files.push(handlerPath)
    }
  }

  // Count schemas from generated code
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
  handlers: Map<string, string>
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
    // Simple YAML parsing for common OpenAPI patterns
    // For complex YAML, users should pre-parse and pass the object
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
 * Merge new handler stubs into an existing handler file.
 * Only adds functions that don't already exist.
 */
async function mergeHandlerStub(existingPath: string, newCode: string): Promise<string> {
  const existing = await readFile(existingPath, 'utf-8')

  // Extract function names from existing file
  const existingFns = new Set<string>()
  const fnRegex = /export\s+(?:async\s+)?function\s+(\w+)/g
  let match
  while ((match = fnRegex.exec(existing)) !== null) {
    existingFns.add(match[1]!)
  }

  // Extract new functions that don't exist yet
  const newFns: string[] = []
  const newFnRegex = /(?:\/\*\*[^]*?\*\/\n)?export\s+(?:async\s+)?function\s+(\w+)[^]*?^\}/gm
  while ((match = newFnRegex.exec(newCode)) !== null) {
    if (!existingFns.has(match[1]!)) {
      newFns.push(match[0]!)
    }
  }

  if (newFns.length === 0) return existing

  return existing.trimEnd() + '\n\n' + newFns.join('\n\n') + '\n'
}
