import { describe, expect, it } from 'vitest'

import { extractResolveBody, spliceResolveBody } from '#src/codegen/preserve.ts'

const implementedRoute = `
import { silgi, SilgiError } from 'silgi'
import * as schemas from '../../schemas.gen.ts'

const s = silgi()

export const listPets = s
  .$route({
    path: '/pets',
    method: 'GET',
  })
  .$input(schemas.listPetsInputSchema)
  .$output(schemas.listPetsOutputSchema)
  .$resolve(async ({ input, ctx }) => {
    const pets = await ctx.db.pets.findMany({
      take: input.limit ?? 20,
      cursor: input.cursor,
    })
    return pets
  })
`

const stubRoute = `
import { silgi, SilgiError } from 'silgi'
import * as schemas from '../../schemas.gen.ts'

const s = silgi()

export const listPets = s
  .$route({
    path: '/pets',
    method: 'GET',
  })
  .$input(schemas.listPetsInputSchema)
  .$resolve(({ input, ctx, fail }) => {
    // TODO: implement listPets
    throw new SilgiError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Not implemented: listPets',
    })
  })
`

const newGenerated = `import { silgi, SilgiError } from 'silgi'
import * as schemas from '../../schemas.gen.ts'

const s = silgi()

/** List all pets */
export const listPets = s
  .$route({
    path: '/pets',
    method: 'GET',
    summary: "List all pets",
    tags: ["pets"],
    operationId: "listPets",
  })
  .$input(schemas.listPetsInputSchema)
  .$output(schemas.listPetsOutputSchema)
  .$errors({
    UNAUTHORIZED: 401,
  })
  .$resolve(({ input, ctx, fail }) => {
    // TODO: implement listPets
    throw new SilgiError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Not implemented: listPets',
    })
  })
`

describe('extractResolveBody', () => {
  it('extracts implemented resolve body', () => {
    const body = extractResolveBody(implementedRoute)
    expect(body).not.toBeNull()
    expect(body).toContain('ctx.db.pets.findMany')
    expect(body).toContain('input.limit ?? 20')
  })

  it('returns null for stub (Not implemented)', () => {
    const body = extractResolveBody(stubRoute)
    expect(body).toBeNull()
  })

  it('returns null for unparseable code', () => {
    const body = extractResolveBody('not valid typescript {{{{')
    expect(body).toBeNull()
  })

  it('returns null for empty string', () => {
    const body = extractResolveBody('')
    expect(body).toBeNull()
  })
})

describe('spliceResolveBody', () => {
  it('replaces stub resolve with preserved implementation', () => {
    const preserved = extractResolveBody(implementedRoute)!
    const result = spliceResolveBody(newGenerated, preserved)

    // Should have the new metadata (summary, tags, errors)
    expect(result).toContain('summary: "List all pets"')
    expect(result).toContain('tags: ["pets"]')
    expect(result).toContain('UNAUTHORIZED: 401')

    // Should have the preserved resolve body
    expect(result).toContain('ctx.db.pets.findMany')
    expect(result).toContain('input.limit ?? 20')

    // Should NOT have the stub
    expect(result).not.toContain('Not implemented')
  })

  it('preserves async keyword', () => {
    const preserved = extractResolveBody(implementedRoute)!
    expect(preserved).toContain('async')

    const result = spliceResolveBody(newGenerated, preserved)
    expect(result).toContain('async ({ input, ctx })')
  })

  it('returns generated code unchanged if AST parse fails', () => {
    const result = spliceResolveBody('broken {{', 'some body')
    expect(result).toBe('broken {{')
  })
})

describe('smart strategy end-to-end', () => {
  it('developer implements → spec changes → resolve preserved, metadata updated', () => {
    // 1. Developer has implemented the route
    const existing = implementedRoute

    // 2. Spec changes: new errors, new summary, new output schema
    const regenerated = newGenerated

    // 3. Smart merge: extract resolve, splice into new generated
    const preserved = extractResolveBody(existing)!
    const result = spliceResolveBody(regenerated, preserved)

    // New metadata present
    expect(result).toContain('operationId: "listPets"')
    expect(result).toContain('UNAUTHORIZED: 401')
    expect(result).toContain('.$output(schemas.listPetsOutputSchema)')

    // Developer's code preserved
    expect(result).toContain('ctx.db.pets.findMany')
  })
})
