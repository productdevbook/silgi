import { describe, it, expect, vi } from 'vitest'

describe('DynamicLink', () => {
  it('resolves link per-call based on path and options', async () => {
    const { DynamicLink } = await import('#src/client/dynamic-link.ts')

    const linkA = { call: vi.fn().mockResolvedValue('A') }
    const linkB = { call: vi.fn().mockResolvedValue('B') }

    const dynamic = new DynamicLink((path, _input, options) => {
      if ((options as any).context?.admin) return linkA
      return linkB
    })

    const r1 = await dynamic.call(['test'], {}, { context: { admin: true } } as any)
    expect(r1).toBe('A')
    expect(linkA.call).toHaveBeenCalledTimes(1)

    const r2 = await dynamic.call(['test'], {}, {} as any)
    expect(r2).toBe('B')
    expect(linkB.call).toHaveBeenCalledTimes(1)
  })

  it('routes to different links based on path', async () => {
    const { DynamicLink } = await import('#src/client/dynamic-link.ts')

    const linkA = { call: vi.fn().mockResolvedValue('a') }
    const linkB = { call: vi.fn().mockResolvedValue('b') }

    const dynamic = new DynamicLink((path) => {
      return path[0] === 'admin' ? linkA : linkB
    })

    await dynamic.call(['admin', 'stats'], {}, {})
    expect(linkA.call).toHaveBeenCalled()
    expect(linkB.call).not.toHaveBeenCalled()

    await dynamic.call(['users', 'list'], {}, {})
    expect(linkB.call).toHaveBeenCalled()
  })
})
