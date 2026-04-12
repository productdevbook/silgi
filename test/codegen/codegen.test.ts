import { describe, expect, it } from 'vitest'

import { createSchemaContext, generate, jsonSchemaToCode, parseOpenAPI } from '#src/codegen/index.ts'

import type { OpenAPISpec } from '#src/codegen/parse.ts'
import type { SchemaContext } from '#src/codegen/schema-to-code.ts'

// ── Petstore-like fixture ──────────────────────────────

const petstoreSpec: OpenAPISpec = {
  openapi: '3.1.0',
  info: { title: 'Petstore', version: '1.0.0' },
  tags: [
    { name: 'pets', description: 'Pet operations' },
    { name: 'store', description: 'Store operations' },
  ],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'A list of pets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  tag: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Pet created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '409': { description: 'CONFLICT' },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'A pet',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '404': { description: 'NOT_FOUND' },
        },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        tags: ['pets'],
        deprecated: true,
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'Pet deleted' },
          '404': { description: 'NOT_FOUND' },
        },
      },
    },
    '/store/inventory': {
      get: {
        operationId: 'getInventory',
        summary: 'Get store inventory',
        tags: ['store'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description: 'Inventory map',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          tag: { type: 'string' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      },
    },
  },
}

// ── Tests ──────────────────────────────────────────────

describe('parseOpenAPI', () => {
  it('parses all operations', () => {
    const { operations, components } = parseOpenAPI(petstoreSpec)
    expect(operations).toHaveLength(5)
    expect(Object.keys(components)).toEqual(['Pet'])
  })

  it('extracts path params', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const getPet = operations.find((o) => o.operationId === 'getPet')!
    expect(getPet.pathParams).toHaveLength(1)
    expect(getPet.pathParams[0]!.name).toBe('petId')
    expect(getPet.pathParams[0]!.required).toBe(true)
  })

  it('extracts query params', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const listPets = operations.find((o) => o.operationId === 'listPets')!
    expect(listPets.queryParams).toHaveLength(2)
    expect(listPets.queryParams[0]!.name).toBe('limit')
    expect(listPets.queryParams[0]!.required).toBe(false)
  })

  it('converts path to Silgi format', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const getPet = operations.find((o) => o.operationId === 'getPet')!
    expect(getPet.silgiPath).toBe('/pets/:petId')
  })

  it('extracts request body', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const createPet = operations.find((o) => o.operationId === 'createPet')!
    expect(createPet.body).not.toBeNull()
    expect(createPet.bodyRequired).toBe(true)
  })

  it('parses error responses', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const getPet = operations.find((o) => o.operationId === 'getPet')!
    expect(getPet.errors.has(404)).toBe(true)
  })

  it('parses success status', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const createPet = operations.find((o) => o.operationId === 'createPet')!
    expect(createPet.successStatus).toBe(201)
  })

  it('extracts security', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const getInventory = operations.find((o) => o.operationId === 'getInventory')!
    expect(getInventory.security).toEqual(['apiKey'])
  })

  it('extracts deprecated flag', () => {
    const { operations } = parseOpenAPI(petstoreSpec)
    const deletePet = operations.find((o) => o.operationId === 'deletePet')!
    expect(deletePet.deprecated).toBe(true)
  })
})

// ── Schema Converter — Zod ─────────────────────────────

describe('jsonSchemaToCode (zod)', () => {
  function ctx(): SchemaContext {
    return createSchemaContext('zod')
  }

  it('converts string', () => {
    expect(jsonSchemaToCode({ type: 'string' }, ctx())).toBe('z.string()')
  })

  it('converts string with email format', () => {
    expect(jsonSchemaToCode({ type: 'string', format: 'email' }, ctx())).toBe('z.string().email()')
  })

  it('converts string with constraints', () => {
    const result = jsonSchemaToCode({ type: 'string', minLength: 1, maxLength: 100 }, ctx())
    expect(result).toBe('z.string().min(1).max(100)')
  })

  it('converts integer', () => {
    expect(jsonSchemaToCode({ type: 'integer' }, ctx())).toBe('z.int()')
  })

  it('converts number with constraints', () => {
    const result = jsonSchemaToCode({ type: 'number', minimum: 0, maximum: 100 }, ctx())
    expect(result).toBe('z.number().min(0).max(100)')
  })

  it('converts boolean', () => {
    expect(jsonSchemaToCode({ type: 'boolean' }, ctx())).toBe('z.boolean()')
  })

  it('converts enum', () => {
    const result = jsonSchemaToCode({ type: 'string', enum: ['a', 'b', 'c'] }, ctx())
    expect(result).toBe('z.enum(["a", "b", "c"])')
  })

  it('converts const', () => {
    expect(jsonSchemaToCode({ const: 'active' }, ctx())).toBe('z.literal("active")')
  })

  it('converts array', () => {
    const result = jsonSchemaToCode({ type: 'array', items: { type: 'string' } }, ctx())
    expect(result).toBe('z.array(z.string())')
  })

  it('converts array with constraints', () => {
    const result = jsonSchemaToCode({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 }, ctx())
    expect(result).toBe('z.array(z.string()).min(1).max(10)')
  })

  it('converts object with properties', () => {
    const result = jsonSchemaToCode(
      {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
      },
      ctx(),
    )
    expect(result).toContain('z.object({')
    expect(result).toContain('name: z.string()')
    expect(result).toContain('age: z.int().optional()')
    expect(result).not.toContain('name: z.string().optional()')
  })

  it('converts record (additionalProperties)', () => {
    const result = jsonSchemaToCode({ type: 'object', additionalProperties: { type: 'integer' } }, ctx())
    expect(result).toBe('z.record(z.string(), z.int())')
  })

  it('converts nullable', () => {
    const result = jsonSchemaToCode({ type: 'string', nullable: true }, ctx())
    expect(result).toBe('z.string().nullable()')
  })

  it('converts type array with null', () => {
    const result = jsonSchemaToCode({ type: ['string', 'null'] }, ctx())
    expect(result).toBe('z.string().nullable()')
  })

  it('converts oneOf as union', () => {
    const result = jsonSchemaToCode({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, ctx())
    expect(result).toBe('z.union([z.string(), z.int()])')
  })

  it('converts allOf as intersection', () => {
    const result = jsonSchemaToCode(
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] },
        ],
      },
      ctx(),
    )
    expect(result).toContain('.and(')
  })

  it('resolves $ref', () => {
    const c = createSchemaContext('zod', { Pet: { type: 'object', properties: { name: { type: 'string' } } } })
    const result = jsonSchemaToCode({ $ref: '#/components/schemas/Pet' }, c)
    expect(result).toBe('PetSchema')
    expect(c.refs.has('Pet')).toBe(true)
  })

  it('adds description', () => {
    const result = jsonSchemaToCode({ type: 'string', description: 'A name' }, ctx())
    expect(result).toBe('z.string().describe("A name")')
  })

  it('adds default', () => {
    const result = jsonSchemaToCode({ type: 'integer', default: 10 }, ctx())
    expect(result).toBe('z.int().default(10)')
  })
})

// ── Schema Converter — Valibot ─────────────────────────

describe('jsonSchemaToCode (valibot)', () => {
  function ctx(): SchemaContext {
    return createSchemaContext('valibot')
  }

  it('converts string', () => {
    expect(jsonSchemaToCode({ type: 'string' }, ctx())).toBe('v.string()')
  })

  it('converts string with email format', () => {
    expect(jsonSchemaToCode({ type: 'string', format: 'email' }, ctx())).toBe('v.pipe(v.string(), v.email())')
  })

  it('converts string with constraints', () => {
    const result = jsonSchemaToCode({ type: 'string', minLength: 1, maxLength: 100 }, ctx())
    expect(result).toBe('v.pipe(v.string(), v.minValue(1), v.maxValue(100))')
  })

  it('converts integer', () => {
    expect(jsonSchemaToCode({ type: 'integer' }, ctx())).toBe('v.pipe(v.number(), v.integer())')
  })

  it('converts boolean', () => {
    expect(jsonSchemaToCode({ type: 'boolean' }, ctx())).toBe('v.boolean()')
  })

  it('converts enum as picklist', () => {
    const result = jsonSchemaToCode({ type: 'string', enum: ['a', 'b', 'c'] }, ctx())
    expect(result).toBe('v.picklist(["a", "b", "c"])')
  })

  it('converts array', () => {
    const result = jsonSchemaToCode({ type: 'array', items: { type: 'string' } }, ctx())
    expect(result).toBe('v.array(v.string())')
  })

  it('converts object with required/optional', () => {
    const result = jsonSchemaToCode(
      {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
      },
      ctx(),
    )
    expect(result).toContain('v.object({')
    expect(result).toContain('name: v.string()')
    expect(result).toContain('age: v.optional(v.pipe(v.number(), v.integer()))')
  })

  it('converts nullable', () => {
    const result = jsonSchemaToCode({ type: 'string', nullable: true }, ctx())
    expect(result).toBe('v.nullable(v.string())')
  })

  it('converts union', () => {
    const result = jsonSchemaToCode({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, ctx())
    expect(result).toBe('v.union([v.string(), v.pipe(v.number(), v.integer())])')
  })

  it('converts intersection', () => {
    const result = jsonSchemaToCode(
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
        ],
      },
      ctx(),
    )
    expect(result).toContain('v.intersect([')
  })

  it('converts record', () => {
    const result = jsonSchemaToCode({ type: 'object', additionalProperties: { type: 'integer' } }, ctx())
    expect(result).toBe('v.record(v.string(), v.pipe(v.number(), v.integer()))')
  })

  it('converts discriminated union as variant', () => {
    const result = jsonSchemaToCode(
      {
        discriminator: { propertyName: 'type' },
        oneOf: [
          { type: 'object', properties: { type: { const: 'a' } }, required: ['type'] },
          { type: 'object', properties: { type: { const: 'b' } }, required: ['type'] },
        ],
      },
      ctx(),
    )
    expect(result).toContain('v.variant("type"')
  })
})

// ── Schema Converter — ArkType ─────────────────────────

describe('jsonSchemaToCode (arktype)', () => {
  function ctx(): SchemaContext {
    return createSchemaContext('arktype')
  }

  it('converts string', () => {
    expect(jsonSchemaToCode({ type: 'string' }, ctx())).toBe("type('string')")
  })

  it('converts email', () => {
    expect(jsonSchemaToCode({ type: 'string', format: 'email' }, ctx())).toBe("type('string.email')")
  })

  it('converts integer', () => {
    expect(jsonSchemaToCode({ type: 'integer' }, ctx())).toBe("type('number.integer')")
  })

  it('converts boolean', () => {
    expect(jsonSchemaToCode({ type: 'boolean' }, ctx())).toBe("type('boolean')")
  })

  it('converts array', () => {
    const result = jsonSchemaToCode({ type: 'array', items: { type: 'string' } }, ctx())
    expect(result).toBe("type('string').array()")
  })

  it('converts nullable', () => {
    const result = jsonSchemaToCode({ type: 'string', nullable: true }, ctx())
    expect(result).toBe("type('string').or(type('null'))")
  })

  it('converts object', () => {
    const result = jsonSchemaToCode(
      {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
      },
      ctx(),
    )
    expect(result).toContain('type({')
    expect(result).toContain('"name"')
    expect(result).toContain('"age?"')
  })

  it('converts union with .or()', () => {
    const result = jsonSchemaToCode({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, ctx())
    expect(result).toContain('.or(')
  })
})

// ── Generate — multi-target ────────────────────────────

describe('generate', () => {
  it('generates schemas, router, and route modules (zod default)', () => {
    const result = generate(petstoreSpec)
    expect(result.schemas).toContain("import { z } from 'zod'")
    expect(result.schemas).toContain('PetSchema')
    expect(result.schemas).toContain('listPetsInputSchema')
    expect(result.schemas).toContain('listPetsOutputSchema')
    expect(result.router).toContain("import { silgi } from 'silgi'")
    expect(result.router).toContain('export const router')
    expect(result.router).toContain('export type AppRouter')
    expect(result.operations).toHaveLength(5)
  })

  it('generates valibot schemas', () => {
    const result = generate(petstoreSpec, { schema: 'valibot' })
    expect(result.schemas).toContain("import * as v from 'valibot'")
    expect(result.schemas).toContain('v.object({')
    expect(result.schemas).toContain('v.string()')
    expect(result.schemas).toContain('v.picklist(')
  })

  it('generates arktype schemas', () => {
    const result = generate(petstoreSpec, { schema: 'arktype' })
    expect(result.schemas).toContain("import { type } from 'arktype'")
    expect(result.schemas).toContain("type('string')")
    expect(result.schemas).toContain('type({')
  })

  it('one file per operation with inline resolve', () => {
    const result = generate(petstoreSpec)
    const listPets = result.routes.get('pets/listPets')!
    expect(listPets).toContain('export const listPets = s')
    expect(listPets).toContain('.$resolve(({ input, ctx, fail }) => {')
    expect(listPets).toContain('// TODO: implement listPets')
    expect(listPets).toContain("import { silgi, SilgiError } from 'silgi'")
  })

  it('groups operations into folders by tag', () => {
    const result = generate(petstoreSpec, { groupBy: 'tag' })
    expect(result.routes.has('pets/listPets')).toBe(true)
    expect(result.routes.has('pets/createPet')).toBe(true)
    expect(result.routes.has('pets/getPet')).toBe(true)
    expect(result.routes.has('store/getInventory')).toBe(true)
  })

  it('groups flat', () => {
    const result = generate(petstoreSpec, { groupBy: 'flat' })
    expect(result.routes.has('default/listPets')).toBe(true)
    expect(result.routes.has('default/getInventory')).toBe(true)
  })

  it('operation files contain $route with correct metadata', () => {
    const result = generate(petstoreSpec)
    const getPet = result.routes.get('pets/getPet')!
    expect(getPet).toContain("path: '/pets/:petId'")
    expect(getPet).toContain("method: 'GET'")
    expect(getPet).toContain('operationId: "getPet"')
  })

  it('operation files contain $errors', () => {
    const result = generate(petstoreSpec)
    const getPet = result.routes.get('pets/getPet')!
    expect(getPet).toContain('NOT_FOUND: 404')
    const createPet = result.routes.get('pets/createPet')!
    expect(createPet).toContain('CONFLICT: 409')
  })

  it('operation files contain $input and $output', () => {
    const result = generate(petstoreSpec)
    const listPets = result.routes.get('pets/listPets')!
    expect(listPets).toContain('.$input(schemas.listPetsInputSchema)')
    expect(listPets).toContain('.$output(schemas.listPetsOutputSchema)')
  })

  it('root router imports each operation and builds grouped tree', () => {
    const result = generate(petstoreSpec)
    expect(result.router).toContain("import { listPets } from './routes/pets/listPets.ts'")
    expect(result.router).toContain("import { getInventory } from './routes/store/getInventory.ts'")
    expect(result.router).toContain('pets: {')
    expect(result.router).toContain('    listPets,')
    expect(result.router).toContain('store: {')
    expect(result.router).toContain('    getInventory,')
  })

  it('respects custom instance name', () => {
    const result = generate(petstoreSpec, { instanceName: 'k' })
    expect(result.router).toContain('const k = silgi()')
    expect(result.router).toContain('k.router(')
    const listPets = result.routes.get('pets/listPets')!
    expect(listPets).toContain('const k = silgi()')
  })

  it('generates deprecated procedures', () => {
    const result = generate(petstoreSpec)
    const deletePet = result.routes.get('pets/deletePet')!
    expect(deletePet).toContain('deprecated: true')
  })

  it('generates security metadata', () => {
    const result = generate(petstoreSpec)
    const getInventory = result.routes.get('store/getInventory')!
    expect(getInventory).toContain('security: ["apiKey"]')
  })

  it('generates component schemas from refs', () => {
    const result = generate(petstoreSpec)
    expect(result.schemas).toContain('PetSchema')
    expect(result.schemas).toContain('z.object({')
    expect(result.schemas).toContain('status: z.enum(["available", "pending", "sold"])')
  })

  it('generates success status for non-200', () => {
    const result = generate(petstoreSpec)
    const createPet = result.routes.get('pets/createPet')!
    expect(createPet).toContain('successStatus: 201')
  })
})

describe('edge cases', () => {
  it('handles empty spec', () => {
    const result = generate({ openapi: '3.1.0', info: { title: 'Empty', version: '1.0.0' } })
    expect(result.operations).toHaveLength(0)
    expect(result.routes.size).toBe(0)
  })

  it('generates fallback operationId', () => {
    const spec: OpenAPISpec = {
      openapi: '3.1.0',
      info: { title: 'No IDs', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    const { operations } = parseOpenAPI(spec)
    expect(operations[0]!.operationId).toBe('getUsers')
  })

  it('handles path-level parameters', () => {
    const spec: OpenAPISpec = {
      openapi: '3.1.0',
      info: { title: 'Path Params', version: '1.0.0' },
      paths: {
        '/orgs/{orgId}/members': {
          parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            operationId: 'listMembers',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    const { operations } = parseOpenAPI(spec)
    expect(operations[0]!.pathParams).toHaveLength(1)
    expect(operations[0]!.pathParams[0]!.name).toBe('orgId')
  })
})
