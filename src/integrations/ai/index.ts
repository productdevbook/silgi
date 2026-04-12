/**
 * Vercel AI SDK integration — expose silgi procedures as AI tools.
 *
 * Converts silgi router procedures into AI SDK tools that can be
 * called by LLMs via function calling / tool use.
 *
 * @example
 * ```ts
 * import { generateText } from "ai"
 * import { openai } from "@ai-sdk/openai"
 * import { routerToTools } from "silgi/ai"
 *
 * const tools = routerToTools(appRouter)
 *
 * const { text } = await generateText({
 *   model: openai("gpt-4o"),
 *   tools,
 *   prompt: "List all users with limit 5",
 * })
 * ```
 */

import { tool, jsonSchema } from 'ai'

import { compileProcedure } from '../../compile.ts'

import type { RouterDef, ProcedureDef } from '../../types.ts'

/**
 * Convert a single silgi procedure into an AI SDK tool.
 */
export function procedureToTool(name: string, procedure: ProcedureDef, options?: { description?: string }) {
  const handler = compileProcedure(procedure)
  const description =
    options?.description ?? (procedure.route as any)?.description ?? (procedure.route as any)?.summary ?? `Call ${name}`

  // Extract JSON Schema from Zod input schema
  const parameters = procedure.input
    ? zodToJsonSchemaSimple(procedure.input)
    : { type: 'object' as const, properties: {} }

  return (tool as Function)({
    description,
    parameters: jsonSchema(parameters as any),
    execute: async (input: any, execOptions?: { abortSignal?: AbortSignal }) => {
      const ctx: Record<string, unknown> = Object.create(null)
      const signal = execOptions?.abortSignal ?? new AbortController().signal
      const result = handler(ctx, input ?? {}, signal)
      return result instanceof Promise ? await result : result
    },
  })
}

/**
 * Convert all procedures in a silgi router into AI SDK tools.
 * Nested routers are flattened with underscore separators.
 *
 * @example
 * ```ts
 * // Router: { users: { list, create }, health }
 * // Tools: { users_list, users_create, health }
 * ```
 */
export function routerToTools(
  router: RouterDef,
  options?: {
    /** Filter which procedures to expose as tools */
    filter?: (path: string, procedure: ProcedureDef) => boolean
    /** Custom descriptions per path */
    descriptions?: Record<string, string>
  },
): Record<string, any> {
  const tools: Record<string, any> = {}

  collectProcedures(router, [], (path, proc) => {
    const flatName = path.join('_')
    if (options?.filter && !options.filter(flatName, proc)) return

    tools[flatName] = procedureToTool(flatName, proc, {
      description: options?.descriptions?.[flatName],
    })
  })

  return tools
}

// ── Helpers ──────────────────────────────────────────

function isProcedureDef(v: unknown): v is ProcedureDef {
  return typeof v === 'object' && v !== null && 'type' in v && 'resolve' in v
}

function collectProcedures(node: unknown, path: string[], cb: (path: string[], proc: ProcedureDef) => void): void {
  if (isProcedureDef(node)) {
    cb(path, node)
    return
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      collectProcedures(child, [...path, key], cb)
    }
  }
}

/** Simple Zod → JSON Schema for AI tool parameters */
function zodToJsonSchemaSimple(schema: any): Record<string, unknown> {
  const zod = schema?._zod ?? schema?._def
  if (!zod) return { type: 'object', properties: {} }
  const def = zod.def ?? zod
  return convertDef(def)
}

function convertDef(def: any): Record<string, unknown> {
  if (!def) return {}
  const type = def.type ?? def.typeName
  switch (type) {
    case 'string':
      return { type: 'string' }
    case 'number':
    case 'float':
      return { type: 'number' }
    case 'int':
      return { type: 'integer' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object': {
      const props: Record<string, unknown> = {}
      const required: string[] = []
      if (def.shape) {
        for (const [k, v] of Object.entries(def.shape)) {
          props[k] = zodToJsonSchemaSimple(v)
          const fz = (v as any)?._zod?.def ?? (v as any)?._def
          if (fz?.type !== 'optional' && fz?.typeName !== 'ZodOptional') required.push(k)
        }
      }
      return { type: 'object', properties: props, ...(required.length ? { required } : {}) }
    }
    case 'array':
      return { type: 'array', ...(def.element ? { items: zodToJsonSchemaSimple(def.element) } : {}) }
    case 'optional':
      return zodToJsonSchemaSimple(def.innerType ?? def.inner)
    case 'enum':
      return { type: 'string', enum: def.values ?? def.entries }
    default:
      return {}
  }
}
