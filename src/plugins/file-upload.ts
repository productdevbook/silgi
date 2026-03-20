/**
 * File upload/download — type-safe File/Blob handling.
 *
 * Parse multipart/form-data requests and pass File objects
 * to procedure handlers. Works with serve() and handler().
 *
 * @example
 * ```ts
 * import { fileInput, fileGuard } from "katman/plugins"
 *
 * const uploadAvatar = k
 *   .$use(fileGuard({ maxFileSize: 5 * 1024 * 1024, allowedTypes: ["image/*"] }))
 *   .$resolve(async ({ ctx }) => {
 *     const file = ctx.file
 *     const buffer = await file.arrayBuffer()
 *     return { name: file.name, size: file.size, type: file.type }
 *   })
 * ```
 */

import { KatmanError } from '../core/error.ts'

import type { GuardDef } from '../types.ts'

export interface FileGuardOptions {
  /** Maximum file size in bytes. Default: 10MB */
  maxFileSize?: number
  /** Allowed MIME types (supports wildcards like "image/*"). Default: all */
  allowedTypes?: string[]
  /** Maximum number of files. Default: 1 */
  maxFiles?: number
  /** Form field name for the file. Default: "file" */
  fieldName?: string
}

export interface UploadedFile {
  name: string
  size: number
  type: string
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  stream(): ReadableStream<Uint8Array>
}

/**
 * Guard that parses multipart file uploads from the request.
 *
 * Adds `ctx.file` (single) or `ctx.files` (multiple) to the context.
 * Validates file size and MIME type before the procedure runs.
 */
export function fileGuard(options: FileGuardOptions = {}): GuardDef<Record<string, unknown>> {
  const { maxFileSize = 10 * 1024 * 1024, allowedTypes, maxFiles = 1, fieldName = 'file' } = options

  return {
    kind: 'guard',
    fn: (ctx: Record<string, unknown>) => {
      const files = ctx.__files as UploadedFile[] | undefined
      if (!files || files.length === 0) {
        throw new KatmanError('BAD_REQUEST', {
          status: 400,
          message: 'No file uploaded',
        })
      }

      if (files.length > maxFiles) {
        throw new KatmanError('BAD_REQUEST', {
          status: 400,
          message: `Too many files: ${files.length} (max ${maxFiles})`,
        })
      }

      for (const file of files) {
        if (file.size > maxFileSize) {
          throw new KatmanError('PAYLOAD_TOO_LARGE', {
            status: 413,
            message: `File too large: ${file.size} bytes (max ${maxFileSize})`,
            data: { maxFileSize, actualSize: file.size, fileName: file.name },
          })
        }

        if (allowedTypes && !matchesMimeType(file.type, allowedTypes)) {
          throw new KatmanError('BAD_REQUEST', {
            status: 400,
            message: `File type not allowed: ${file.type}`,
            data: { allowedTypes, actualType: file.type, fileName: file.name },
          })
        }
      }

      // Add to context
      return maxFiles === 1 ? { file: files[0]! } : { files }
    },
  }
}

/**
 * Parse multipart form data from a Request.
 * Returns files and fields separately.
 */
export async function parseMultipart(request: Request): Promise<{
  files: UploadedFile[]
  fields: Record<string, string>
}> {
  const formData = await request.formData()
  const files: UploadedFile[] = []
  const fields: Record<string, string> = {}

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      files.push({
        name: value.name,
        size: value.size,
        type: value.type,
        arrayBuffer: () => value.arrayBuffer(),
        text: () => value.text(),
        stream: () => value.stream(),
      })
    } else {
      fields[key] = value
    }
  }

  return { files, fields }
}

function matchesMimeType(actual: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === '*' || pattern === '*/*') return true
    if (pattern === actual) return true
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2)
      if (actual.startsWith(prefix + '/')) return true
    }
  }
  return false
}
