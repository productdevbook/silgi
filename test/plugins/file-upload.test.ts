import { describe, it, expect } from 'vitest'

import { fileGuard } from '#src/plugins/file-upload.ts'

describe('fileGuard', () => {
  it('throws when no files', () => {
    const guard = fileGuard()
    expect(() => guard.fn({ __files: [] })).toThrow()
    expect(() => guard.fn({})).toThrow()
  })

  it('throws when file too large', () => {
    const guard = fileGuard({ maxFileSize: 100 })
    const file = { name: 'big.txt', size: 200, type: 'text/plain' }
    expect(() => guard.fn({ __files: [file] })).toThrow()
  })

  it('throws when MIME type not allowed', () => {
    const guard = fileGuard({ allowedTypes: ['image/*'] })
    const file = { name: 'doc.pdf', size: 100, type: 'application/pdf' }
    expect(() => guard.fn({ __files: [file] })).toThrow()
  })

  it('passes valid files', () => {
    const guard = fileGuard({ maxFileSize: 1000, allowedTypes: ['image/*'] })
    const file = { name: 'photo.jpg', size: 500, type: 'image/jpeg' }
    const result = guard.fn({ __files: [file] })
    expect(result).toEqual({ file })
  })

  it('returns files array when maxFiles > 1', () => {
    const guard = fileGuard({ maxFiles: 3 })
    const files = [
      { name: 'a.txt', size: 10, type: 'text/plain' },
      { name: 'b.txt', size: 20, type: 'text/plain' },
    ]
    const result = guard.fn({ __files: files })
    expect(result).toEqual({ files })
  })
})
