import { generate } from '../../src/codegen/index.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const petstoreSpec = {
  openapi: '3.1.0',
  info: { title: 'Petstore API', version: '1.0.0', description: 'A sample Petstore API' },
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
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['available', 'pending', 'sold'] } },
        ],
        responses: {
          '200': {
            description: 'A list of pets',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
          '401': { description: 'UNAUTHORIZED' },
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
              schema: { $ref: '#/components/schemas/CreatePetInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Pet created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '409': { description: 'CONFLICT' },
          '422': { description: 'UNPROCESSABLE_ENTITY' },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'A single pet',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '404': { description: 'NOT_FOUND' },
        },
      },
      put: {
        operationId: 'updatePet',
        summary: 'Update a pet',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdatePetInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Pet updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '404': { description: 'NOT_FOUND' },
          '409': { description: 'CONFLICT' },
        },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        tags: ['pets'],
        deprecated: true,
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '204': { description: 'Pet deleted' },
          '404': { description: 'NOT_FOUND' },
        },
      },
    },
    '/store/inventory': {
      get: {
        operationId: 'getInventory',
        summary: 'Returns pet inventories by status',
        tags: ['store'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description: 'Inventory counts by status',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    '/store/orders': {
      post: {
        operationId: 'placeOrder',
        summary: 'Place an order for a pet',
        tags: ['store'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Order placed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
          '400': { description: 'BAD_REQUEST' },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          tag: { type: 'string', description: 'Optional classification tag' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
          photoUrls: { type: 'array', items: { type: 'string', format: 'url' } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreatePetInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          tag: { type: 'string' },
          photoUrls: { type: 'array', items: { type: 'string', format: 'url' } },
        },
      },
      UpdatePetInput: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          tag: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      },
      Order: {
        type: 'object',
        required: ['id', 'petId', 'quantity', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          petId: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer', minimum: 1, maximum: 10 },
          status: { type: 'string', enum: ['placed', 'approved', 'delivered'] },
          shipDate: { type: 'string', format: 'date-time' },
          complete: { type: 'boolean', default: false },
        },
      },
      OrderInput: {
        type: 'object',
        required: ['petId', 'quantity'],
        properties: {
          petId: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  },
}

const outBase = '/Users/code/Work/pb/katman/test/codegen/output'

for (const target of ['zod', 'valibot', 'arktype'] as const) {
  const result = generate(petstoreSpec as any, { schema: target, groupBy: 'tag' })
  const dir = join(outBase, target)
  await mkdir(join(dir, 'handlers'), { recursive: true })
  await writeFile(join(dir, 'schemas.gen.ts'), result.schemas)
  await writeFile(join(dir, 'router.gen.ts'), result.router)
  for (const [name, code] of result.handlers) {
    await writeFile(join(dir, 'handlers', `${name}.ts`), code)
  }
  console.log(`✓ ${target}: ${result.operations.length} operations`)
}
