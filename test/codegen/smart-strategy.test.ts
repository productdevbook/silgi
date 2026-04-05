import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { generateFromSpec } from '#src/codegen/index.ts'
import type { OpenAPISpec } from '#src/codegen/parse.ts'

// ── Spec v1: initial API ───────────────────────────────

const specV1: OpenAPISpec = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        tags: ['users'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'User list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create user',
        tags: ['users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    },
  },
}

// ── Spec v2: added endpoint, changed existing one ──────

const specV2: OpenAPISpec = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '2.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List all users (updated)',
        tags: ['users'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'User list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
          '401': { description: 'UNAUTHORIZED' },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create user',
        tags: ['users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '409': { description: 'CONFLICT' },
        },
      },
    },
    '/users/{userId}': {
      get: {
        operationId: 'getUser',
        summary: 'Get user by ID',
        tags: ['users'],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'A user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '404': { description: 'NOT_FOUND' },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name', 'email'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
    },
  },
}

// ── Test ────────────────────────────────────────────────

describe('smart strategy — real filesystem', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'silgi-codegen-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('first run: generates stubs', async () => {
    const result = await generateFromSpec({ spec: specV1, outDir })

    expect(result.operationCount).toBe(2)
    expect(result.files.length).toBeGreaterThanOrEqual(4) // schemas + router + 2 routes

    const listUsers = await readFile(join(outDir, 'routes/users/listUsers.ts'), 'utf-8')
    expect(listUsers).toContain('Not implemented')
    expect(listUsers).toContain("path: '/users'")
  })

  it('second run with same spec: stubs overwritten (still stubs)', async () => {
    await generateFromSpec({ spec: specV1, outDir })
    const result = await generateFromSpec({ spec: specV1, outDir })

    const listUsers = await readFile(join(outDir, 'routes/users/listUsers.ts'), 'utf-8')
    expect(listUsers).toContain('Not implemented')
    expect(result.operationCount).toBe(2)
  })

  it('developer implements → re-run → implementation preserved', async () => {
    // Step 1: generate
    await generateFromSpec({ spec: specV1, outDir })

    // Step 2: developer implements listUsers — simulate editing the resolve body
    const routePath = join(outDir, 'routes/users/listUsers.ts')
    const original = await readFile(routePath, 'utf-8')

    // Use spliceResolveBody to simulate what a developer would do
    const { spliceResolveBody } = await import('#src/codegen/preserve.ts')
    const implemented = spliceResolveBody(
      original,
      `async ({ input, ctx }) => {
    const users = await ctx.db.users.findMany({
      take: input.limit ?? 50,
    })
    return users
  }`,
    )
    await writeFile(routePath, implemented, 'utf-8')

    // Verify implementation is there
    const before = await readFile(routePath, 'utf-8')
    expect(before).toContain('ctx.db.users.findMany')
    expect(before).not.toContain('Not implemented')

    // Step 3: re-run codegen with same spec
    await generateFromSpec({ spec: specV1, outDir })

    // Step 4: implementation should be preserved
    const after = await readFile(routePath, 'utf-8')
    expect(after).toContain('ctx.db.users.findMany')
    expect(after).toContain('input.limit ?? 50')
    expect(after).not.toContain('Not implemented')
  })

  it('spec changes → metadata updated, implementation preserved', async () => {
    // Step 1: generate from v1
    await generateFromSpec({ spec: specV1, outDir })

    // Step 2: developer implements listUsers
    const routePath = join(outDir, 'routes/users/listUsers.ts')
    const original = await readFile(routePath, 'utf-8')
    const { spliceResolveBody } = await import('#src/codegen/preserve.ts')
    const implemented = spliceResolveBody(
      original,
      `async ({ input, ctx }) => {
    return ctx.db.users.findMany({ take: input.limit })
  }`,
    )
    await writeFile(routePath, implemented, 'utf-8')

    // Step 3: re-run with v2 (new param, new error, changed summary)
    await generateFromSpec({ spec: specV2, outDir })

    const after = await readFile(routePath, 'utf-8')

    // Metadata updated from v2
    expect(after).toContain('List all users (updated)')
    expect(after).toContain('UNAUTHORIZED: 401')

    // Implementation preserved
    expect(after).toContain('ctx.db.users.findMany')
    expect(after).not.toContain('Not implemented')
  })

  it('new endpoint added in v2 → new file generated as stub', async () => {
    // Step 1: generate from v1
    await generateFromSpec({ spec: specV1, outDir })

    // Step 2: re-run with v2 (getUser is new)
    await generateFromSpec({ spec: specV2, outDir })

    const getUser = await readFile(join(outDir, 'routes/users/getUser.ts'), 'utf-8')
    expect(getUser).toContain('Not implemented')
    expect(getUser).toContain("path: '/users/:userId'")
    expect(getUser).toContain('NOT_FOUND: 404')
  })

  it('unimplemented stub → overwritten with fresh stub on re-run', async () => {
    // Step 1: generate from v1
    await generateFromSpec({ spec: specV1, outDir })

    const routePath = join(outDir, 'routes/users/createUser.ts')
    const v1 = await readFile(routePath, 'utf-8')
    expect(v1).toContain('Not implemented')
    expect(v1).not.toContain('CONFLICT')

    // Step 2: re-run with v2 (createUser now has CONFLICT error + email field)
    await generateFromSpec({ spec: specV2, outDir })

    const v2 = await readFile(routePath, 'utf-8')
    expect(v2).toContain('Not implemented') // still a stub
    expect(v2).toContain('CONFLICT: 409') // but metadata updated
  })

  it('skip strategy: never touches existing files', async () => {
    await generateFromSpec({ spec: specV1, outDir, routeStrategy: 'skip' })

    const routePath = join(outDir, 'routes/users/listUsers.ts')
    const original = await readFile(routePath, 'utf-8')

    // Re-run with v2 and skip
    await generateFromSpec({ spec: specV2, outDir, routeStrategy: 'skip' })

    const after = await readFile(routePath, 'utf-8')
    expect(after).toBe(original) // untouched
  })

  it('overwrite strategy: always regenerates', async () => {
    await generateFromSpec({ spec: specV1, outDir })

    // Developer implements
    const routePath = join(outDir, 'routes/users/listUsers.ts')
    const original = await readFile(routePath, 'utf-8')
    const { spliceResolveBody } = await import('#src/codegen/preserve.ts')
    await writeFile(routePath, spliceResolveBody(original, 'async ({ ctx }) => ctx.db.users.all()'))

    // Overwrite
    await generateFromSpec({ spec: specV2, outDir, routeStrategy: 'overwrite' })

    const after = await readFile(routePath, 'utf-8')
    expect(after).toContain('Not implemented') // implementation gone
    expect(after).not.toContain('ctx.db.users.all')
  })

  it('router.gen.ts always reflects current spec', async () => {
    await generateFromSpec({ spec: specV1, outDir })

    const routerV1 = await readFile(join(outDir, 'router.gen.ts'), 'utf-8')
    expect(routerV1).toContain('listUsers')
    expect(routerV1).toContain('createUser')
    expect(routerV1).not.toContain('getUser')

    await generateFromSpec({ spec: specV2, outDir })

    const routerV2 = await readFile(join(outDir, 'router.gen.ts'), 'utf-8')
    expect(routerV2).toContain('listUsers')
    expect(routerV2).toContain('createUser')
    expect(routerV2).toContain('getUser') // new endpoint
  })

  it('schemas.gen.ts always reflects current spec', async () => {
    await generateFromSpec({ spec: specV1, outDir })

    const schemasV1 = await readFile(join(outDir, 'schemas.gen.ts'), 'utf-8')
    expect(schemasV1).not.toContain('email')

    await generateFromSpec({ spec: specV2, outDir })

    const schemasV2 = await readFile(join(outDir, 'schemas.gen.ts'), 'utf-8')
    expect(schemasV2).toContain('email') // new field in User schema
  })
})
