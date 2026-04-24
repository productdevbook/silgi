/**
 * Standard Schema bridge — works with Zod, Valibot, ArkType, etc.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'

export type Schema<TInput = unknown, TOutput = unknown> = StandardSchemaV1<TInput, TOutput>
export type AnySchema = Schema<any, any>
export type InferSchemaInput<T extends AnySchema> = T extends Schema<infer I, unknown> ? I : never
export type InferSchemaOutput<T extends AnySchema> = T extends Schema<unknown, infer O> ? O : never
export type SchemaIssue = StandardSchemaV1.Issue

export class ValidationError extends Error {
  readonly issues: readonly SchemaIssue[]
  constructor(options: { message?: string; issues: readonly SchemaIssue[] }) {
    super(options.message ?? 'Validation failed')
    this.name = 'ValidationError'
    this.issues = options.issues
  }
}

/**
 * Thrown when a Standard Schema validator itself crashes — e.g. a
 * misconstructed Zod v4 schema like `z.record(z.unknown())` (missing
 * `keyType`) that builds silently but throws inside `.validate()`.
 *
 * Distinct from `ValidationError` (which means the *value* was bad)
 * because the failure is a server-side schema bug, not user input.
 * `cause` holds the original throw so dev tooling can surface the stack.
 */
export class SchemaValidatorCrash extends Error {
  constructor(options: { message?: string; cause: unknown }) {
    super(options.message ?? 'Schema validator crashed', { cause: options.cause })
    this.name = 'SchemaValidatorCrash'
  }
}

/** Sync fast-path: Zod 4 validate() returns sync result — avoid Promise allocation */
export function validateSchema(schema: AnySchema, value: unknown): unknown {
  let result: ReturnType<AnySchema['~standard']['validate']>
  try {
    result = schema['~standard'].validate(value)
  } catch (e) {
    // Validator threw synchronously — schema construction bug, not bad input.
    throw new SchemaValidatorCrash({ cause: e })
  }
  // Sync result (Zod 4, ArkType, Silgi type()) — no Promise overhead
  if (typeof (result as any)?.then !== 'function') {
    if ('issues' in (result as any) && (result as any).issues) {
      throw new ValidationError({ issues: (result as any).issues })
    }
    return (result as { value: unknown }).value
  }
  // Async fallback (Valibot or custom async schemas) — promise reject is
  // also a validator crash, not a soft validation failure.
  return (result as Promise<any>).then(
    (r: any) => {
      if ('issues' in r && r.issues) {
        throw new ValidationError({ issues: r.issues })
      }
      return r.value
    },
    (e: unknown) => {
      throw new SchemaValidatorCrash({ cause: e })
    },
  )
}

export function type<TInput, TOutput = TInput>(
  ...args: TInput extends TOutput
    ? TOutput extends TInput
      ? [map?: (input: TInput) => TOutput]
      : [map: (input: TInput) => TOutput]
    : [map: (input: TInput) => TOutput]
): Schema<TInput, TOutput> {
  const mapFn = args[0]
  return {
    '~standard': {
      version: 1,
      vendor: 'silgi',
      validate(value) {
        return { value: mapFn ? mapFn(value as TInput) : (value as TOutput) }
      },
    },
  } as Schema<TInput, TOutput>
}
