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

export async function validateSchema(schema: AnySchema, value: unknown): Promise<unknown> {
  const result = await schema['~standard'].validate(value)
  if ('issues' in result && result.issues) {
    throw new ValidationError({ issues: result.issues })
  }
  return (result as { value: unknown }).value
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
      vendor: 'katman',
      validate(value) {
        return { value: mapFn ? mapFn(value as TInput) : (value as TOutput) }
      },
    },
  } as Schema<TInput, TOutput>
}
