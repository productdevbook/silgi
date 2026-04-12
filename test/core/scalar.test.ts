import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { scalarHTML, generateOpenAPI, resolveScalarLocal } from '#src/scalar.ts'
import { silgi } from '#src/silgi.ts'

describe('scalarHTML', () => {
  it('uses jsdelivr CDN by default', () => {
    const html = scalarHTML('http://localhost:3000/openapi.json')
    expect(html).toContain('cdn.jsdelivr.net/npm/@scalar/api-reference')
    expect(html).toContain('data-url="http://localhost:3000/openapi.json"')
  })

  it('cdn: "cdn" — explicit jsdelivr', () => {
    const html = scalarHTML('/openapi.json', { cdn: 'cdn' })
    expect(html).toContain('cdn.jsdelivr.net/npm/@scalar/api-reference')
  })

  it('cdn: "unpkg" — uses unpkg.com', () => {
    const html = scalarHTML('/openapi.json', { cdn: 'unpkg' })
    expect(html).toContain('unpkg.com/@scalar/api-reference')
    expect(html).not.toContain('jsdelivr')
  })

  it('cdn: custom URL — self-hosted', () => {
    const html = scalarHTML('/openapi.json', { cdn: '/assets/scalar.js' })
    expect(html).toContain('src="/assets/scalar.js"')
    expect(html).not.toContain('jsdelivr')
    expect(html).not.toContain('unpkg')
  })

  it('cdn: full custom URL', () => {
    const html = scalarHTML('/openapi.json', { cdn: 'https://my-cdn.example.com/scalar@latest.js' })
    expect(html).toContain('src="https://my-cdn.example.com/scalar@latest.js"')
  })

  it('escapes title and spec URL', () => {
    const html = scalarHTML('/api?x=1&y=2', { title: 'My <API> & "Docs"' })
    expect(html).toContain('My &lt;API&gt; &amp; &quot;Docs&quot;')
    expect(html).toContain('data-url="/api?x=1&amp;y=2"')
  })

  it('uses custom title', () => {
    const html = scalarHTML('/spec.json', { title: 'Silgi Playground' })
    expect(html).toContain('<title>Silgi Playground — Scalar</title>')
  })

  it('defaults title to Silgi API', () => {
    const html = scalarHTML('/spec.json')
    expect(html).toContain('<title>Silgi API — Scalar</title>')
  })

  it('cdn: "local" — points to /__silgi/scalar.js', () => {
    const html = scalarHTML('/openapi.json', { cdn: 'local' })
    expect(html).toContain('src="/__silgi/scalar.js"')
    expect(html).not.toContain('jsdelivr')
    expect(html).not.toContain('unpkg')
  })
})

describe('resolveScalarLocal', () => {
  it('returns string or null depending on @scalar/api-reference availability', async () => {
    const result = await resolveScalarLocal()
    // May or may not be installed — both are valid
    expect(result === null || typeof result === 'string').toBe(true)
  })
})

describe('generateOpenAPI', () => {
  const k = silgi({ context: () => ({}) })

  it('generates valid OpenAPI 3.1.0 doc', () => {
    const router = k.router({
      health: k.$resolve(() => ({ ok: true })),
    })
    const spec = generateOpenAPI(router)
    expect(spec.openapi).toBe('3.1.0')
    expect((spec.info as any).title).toBe('Silgi API')
  })

  it('includes error responses in spec', () => {
    const router = k.router({
      users: {
        create: k
          .$input(z.object({ name: z.string() }))
          .$errors({ CONFLICT: 409, VALIDATION: { status: 422, message: 'Invalid' } })
          .$resolve(({ input }) => ({ id: 1, name: input.name })),
      },
    })
    const spec = generateOpenAPI(router)
    const createOp = (spec.paths as any)['/users/create']?.post
    expect(createOp.responses['409']).toBeDefined()
    expect(createOp.responses['422']).toBeDefined()
  })

  it('guard errors appear in OpenAPI spec alongside procedure errors', () => {
    const auth = k.guard({
      errors: { UNAUTHORIZED: 401 },
      fn: () => ({ userId: 1 }),
    })

    const router = k.router({
      users: {
        create: k
          .$use(auth)
          .$input(z.object({ name: z.string() }))
          .$errors({ CONFLICT: 409 })
          .$resolve(({ input }) => ({ id: 1, name: input.name })),
      },
    })
    const spec = generateOpenAPI(router)
    const createOp = (spec.paths as any)['/users/create']?.post
    // Both guard error (401) and procedure error (409) should appear
    expect(createOp.responses['401']).toBeDefined()
    expect(createOp.responses['409']).toBeDefined()
  })

  it('guard errors without procedure errors still appear in spec', () => {
    const auth = k.guard({
      errors: { UNAUTHORIZED: 401, FORBIDDEN: 403 },
      fn: () => ({ userId: 1 }),
    })

    const router = k.router({
      secret: k.$use(auth).$resolve(() => ({ data: 'secret' })),
    })
    const spec = generateOpenAPI(router)
    const secretOp = (spec.paths as any)['/secret']?.post
    expect(secretOp.responses['401']).toBeDefined()
    expect(secretOp.responses['403']).toBeDefined()
  })

  it('$route with explicit method uses that method as OpenAPI key', () => {
    const router = k.router({
      users: {
        list: k.$route({ method: 'get', path: '/users' }).$resolve(() => []),
      },
    })
    const spec = generateOpenAPI(router)
    expect((spec.paths as any)['/users']?.get).toBeDefined()
    expect((spec.paths as any)['/users']?.post).toBeUndefined()
  })

  it('method: "*" produces valid OpenAPI methods, not literal "*"', () => {
    const router = k.router({
      auth: {
        handler: k.$route({ method: '*', path: '/api/auth/**' }).$resolve(() => new Response('ok')),
      },
    })
    const spec = generateOpenAPI(router)
    const paths = spec.paths as Record<string, Record<string, unknown>>
    // Should not have literal '*' as method key — invalid in OpenAPI
    for (const pathObj of Object.values(paths)) {
      expect(pathObj['*']).toBeUndefined()
    }
  })

  it('wildcard path ** is converted to OpenAPI parameter syntax', () => {
    const router = k.router({
      files: {
        serve: k.$route({ method: 'get', path: '/files/**' }).$resolve(() => new Response('ok')),
      },
    })
    const spec = generateOpenAPI(router)
    const paths = Object.keys(spec.paths as Record<string, unknown>)
    // Should not contain literal '**' — not valid OpenAPI
    for (const p of paths) {
      expect(p).not.toContain('**')
    }
  })

  // ── Path parameter conversion ──

  it('converts :param to {param} and declares path parameters', () => {
    const router = k.router({
      users: {
        get: k
          .$route({ method: 'GET', path: '/users/:id' })
          .$input(z.object({ id: z.number() }))
          .$resolve(({ input }) => ({ id: input.id })),
      },
    })
    const spec = generateOpenAPI(router)
    const paths = spec.paths as any
    expect(paths['/users/{id}']).toBeDefined()
    expect(paths['/users/:id']).toBeUndefined()
    const getOp = paths['/users/{id}'].get
    const pathParam = getOp.parameters?.find((p: any) => p.in === 'path' && p.name === 'id')
    expect(pathParam).toBeDefined()
    expect(pathParam.required).toBe(true)
  })

  it('converts :param(regex) to {param}', () => {
    const router = k.router({
      items: k.$route({ method: 'GET', path: '/items/:id(\\d+)' }).$resolve(() => ({})),
    })
    const spec = generateOpenAPI(router)
    expect((spec.paths as any)['/items/{id}']).toBeDefined()
  })

  it('declares {path} parameter for ** wildcard', () => {
    const router = k.router({
      files: k.$route({ method: 'GET', path: '/files/**' }).$resolve(() => new Response('ok')),
    })
    const spec = generateOpenAPI(router)
    const getOp = (spec.paths as any)['/files/{path}'].get
    const pathParam = getOp.parameters?.find((p: any) => p.in === 'path' && p.name === 'path')
    expect(pathParam).toBeDefined()
  })

  // ── Tags ──

  it('uses Route.tags when provided', () => {
    const router = k.router({
      users: {
        list: k.$route({ tags: ['Users', 'Public'] }).$resolve(() => []),
      },
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/users/list'].post
    expect(op.tags).toEqual(['Users', 'Public'])
  })

  it('auto-generates tag from first path segment when no Route.tags', () => {
    const router = k.router({
      users: {
        list: k.$resolve(() => []),
      },
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/users/list'].post
    expect(op.tags).toEqual(['users'])
  })

  // ── operationId ──

  it('uses custom operationId from Route', () => {
    const router = k.router({
      users: {
        list: k.$route({ operationId: 'listAllUsers' }).$resolve(() => []),
      },
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/users/list'].post
    expect(op.operationId).toBe('listAllUsers')
  })

  // ── Security ──

  it('marks procedure as public with security: false', () => {
    const router = k.router({
      public: k.$route({ security: false }).$resolve(() => ({ ok: true })),
    })
    const spec = generateOpenAPI(router, { security: { type: 'http', scheme: 'bearer' } })
    const op = (spec.paths as any)['/public'].post
    expect(op.security).toEqual([])
  })

  it('uses per-procedure security schemes', () => {
    const router = k.router({
      admin: k.$route({ security: ['bearerAuth', 'apiKey'] }).$resolve(() => ({ ok: true })),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/admin'].post
    expect(op.security).toEqual([{ bearerAuth: [] }, { apiKey: [] }])
  })

  // ── Auto 400 BAD_REQUEST ──

  it('auto-documents 400 for procedures with input', () => {
    const router = k.router({
      create: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => input),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/create'].post
    expect(op.responses['400']).toBeDefined()
    expect(op.responses['400'].description).toContain('BAD_REQUEST')
  })

  it('does not auto-document 400 for procedures without input', () => {
    const router = k.router({
      health: k.$resolve(() => ({ ok: true })),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/health'].post
    expect(op.responses['400']).toBeUndefined()
  })

  // ── spec override ──

  it('merges spec object override', () => {
    const router = k.router({
      docs: k.$route({ spec: { externalDocs: { url: 'https://example.com' }, 'x-custom': true } }).$resolve(() => ({})),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/docs'].post
    expect(op.externalDocs).toEqual({ url: 'https://example.com' })
    expect(op['x-custom']).toBe(true)
  })

  it('applies spec function override', () => {
    const router = k.router({
      custom: k.$route({ spec: (op) => ({ ...op, 'x-rate-limit': 100 }) }).$resolve(() => ({})),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/custom'].post
    expect(op['x-rate-limit']).toBe(100)
  })

  // ── Error message ──

  it('includes error message as default in spec', () => {
    const router = k.router({
      fail: k.$errors({ CONFLICT: { status: 409, message: 'Already exists' } }).$resolve(() => ({})),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/fail'].post
    const schema = op.responses['409'].content['application/json'].schema
    expect(schema.properties.message.default).toBe('Already exists')
  })

  // ── Subscription output schema ──

  it('subscription uses text/event-stream content type', () => {
    const router = k.router({
      stream: k.subscription(async function* () {
        yield { tick: 1 }
      }),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/stream'].post
    expect(op.responses['200'].content['text/event-stream']).toBeDefined()
    expect(op.responses['200'].description).toBe('SSE event stream')
  })

  it('catch-all route appears with valid path and method in spec', () => {
    const router = k.router({
      proxy: k.$route({ method: '*', path: '/api/proxy/**' }).$resolve(() => new Response('proxied')),
    })
    const spec = generateOpenAPI(router)
    const paths = spec.paths as Record<string, Record<string, unknown>>
    const pathKeys = Object.keys(paths)
    // Path should be valid OpenAPI (no **)
    expect(pathKeys.length).toBe(1)
    expect(pathKeys[0]).not.toContain('**')
    // Method should be valid OpenAPI (not *)
    const methods = Object.keys(paths[pathKeys[0]!]!)
    const validMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
    for (const m of methods) {
      expect(validMethods).toContain(m)
    }
  })

  // ── $output schema rendering ──

  it('$output with Zod schema produces correct response schema', () => {
    const router = k.router({
      user: k.$output(z.object({ id: z.number(), name: z.string() })).$resolve(() => ({ id: 1, name: 'Alice' })),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/user']?.post
    const response = op.responses['200']
    expect(response.content).toBeDefined()
    const schema = response.content['application/json'].schema
    expect(schema.type).toBe('object')
    expect(schema.properties.id.type).toMatch(/number|integer/)
    expect(schema.properties.name.type).toBe('string')
  })

  it('$input with Zod schema produces correct request body schema', () => {
    const router = k.router({
      create: k.$input(z.object({ name: z.string(), age: z.number() })).$resolve(({ input }) => input),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/create']?.post
    const bodySchema = op.requestBody.content['application/json'].schema
    expect(bodySchema.type).toBe('object')
    expect(bodySchema.properties.name.type).toBe('string')
    expect(bodySchema.properties.age.type).toMatch(/number|integer/)
  })

  it('procedure with both $input and $output renders both schemas', () => {
    const router = k.router({
      users: {
        create: k
          .$input(z.object({ name: z.string() }))
          .$output(z.object({ id: z.number(), name: z.string() }))
          .$resolve(({ input }) => ({ id: 1, name: input.name })),
      },
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/users/create']?.post
    // Input
    const inputSchema = op.requestBody.content['application/json'].schema
    expect(inputSchema.type).toBe('object')
    expect(inputSchema.properties.name).toBeDefined()
    // Output
    const outputSchema = op.responses['200'].content['application/json'].schema
    expect(outputSchema.type).toBe('object')
    expect(outputSchema.properties.id).toBeDefined()
    expect(outputSchema.properties.name).toBeDefined()
  })

  it('no $output produces response without content', () => {
    const router = k.router({
      health: k.$resolve(() => ({ ok: true })),
    })
    const spec = generateOpenAPI(router)
    const op = (spec.paths as any)['/health']?.post
    expect(op.responses['200'].description).toBe('Successful response')
    expect(op.responses['200'].content).toBeUndefined()
  })

  it('$output with nested Zod schema renders correctly', () => {
    const router = k.router({
      jobs: k
        .$output(
          z.object({
            jobs: z.array(
              z.object({
                id: z.number(),
                title: z.string(),
                tags: z.array(z.string()),
              }),
            ),
          }),
        )
        .$resolve(() => ({ jobs: [] })),
    })
    const spec = generateOpenAPI(router)
    const schema = (spec.paths as any)['/jobs']?.post.responses['200'].content['application/json'].schema
    expect(schema.type).toBe('object')
    expect(schema.properties.jobs.type).toBe('array')
    expect(schema.properties.jobs.items.type).toBe('object')
    expect(schema.properties.jobs.items.properties.tags.type).toBe('array')
    expect(schema.properties.jobs.items.properties.tags.items.type).toBe('string')
  })
})
