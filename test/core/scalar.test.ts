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
        list: k
          .$route({ method: 'get', path: '/users' })
          .$resolve(() => []),
      },
    })
    const spec = generateOpenAPI(router)
    expect((spec.paths as any)['/users']?.get).toBeDefined()
    expect((spec.paths as any)['/users']?.post).toBeUndefined()
  })

  it('method: "*" produces valid OpenAPI methods, not literal "*"', () => {
    const router = k.router({
      auth: {
        handler: k
          .$route({ method: '*', path: '/api/auth/**' })
          .$resolve(() => new Response('ok')),
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
        serve: k
          .$route({ method: 'get', path: '/files/**' })
          .$resolve(() => new Response('ok')),
      },
    })
    const spec = generateOpenAPI(router)
    const paths = Object.keys(spec.paths as Record<string, unknown>)
    // Should not contain literal '**' — not valid OpenAPI
    for (const p of paths) {
      expect(p).not.toContain('**')
    }
  })

  it('catch-all route appears with valid path and method in spec', () => {
    const router = k.router({
      proxy: k
        .$route({ method: '*', path: '/api/proxy/**' })
        .$resolve(() => new Response('proxied')),
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
})
