/**
 * Smart route preservation — uses oxc-parser to extract the $resolve() body
 * from an existing route file so it survives regeneration.
 *
 * The strategy: parse the existing file's AST, find the .$resolve(fn) call,
 * extract the fn source code by span, then splice it into the newly generated file.
 */

import { parseSync } from 'oxc-parser'

/**
 * Extract the $resolve() argument source code from a route file.
 * Returns the raw source string of the resolve function, or null if not found
 * or if the resolve body is a stub (contains "Not implemented").
 */
export function extractResolveBody(source: string): string | null {
  try {
    const { program } = parseSync('route.ts', source)

    // Find `export const xxx = s.$route(...)...$resolve(fn)`
    const exportDecl = program.body.find(
      (n: any) => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration',
    ) as any
    if (!exportDecl) return null

    const init = exportDecl.declaration.declarations[0]?.init
    if (!init) return null

    const resolveCall = findResolveCall(init)
    if (!resolveCall || !resolveCall.arguments[0]) return null

    const arg = resolveCall.arguments[0]
    const body = source.slice(arg.start, arg.end)

    // Skip if it's still a stub
    if (body.includes('Not implemented')) return null

    return body
  } catch {
    return null
  }
}

/**
 * Splice a preserved resolve body into a newly generated route file.
 * Replaces the generated stub $resolve(...) argument with the preserved one.
 */
export function spliceResolveBody(generatedSource: string, preservedBody: string): string {
  try {
    const { program } = parseSync('route.ts', generatedSource)

    const exportDecl = program.body.find(
      (n: any) => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration',
    ) as any
    if (!exportDecl) return generatedSource

    const init = exportDecl.declaration.declarations[0]?.init
    if (!init) return generatedSource

    const resolveCall = findResolveCall(init)
    if (!resolveCall || !resolveCall.arguments[0]) return generatedSource

    const arg = resolveCall.arguments[0]
    return generatedSource.slice(0, arg.start) + preservedBody + generatedSource.slice(arg.end)
  } catch {
    return generatedSource
  }
}

/** Walk a chained CallExpression to find .$resolve(...) */
function findResolveCall(node: any): any {
  if (!node) return null
  if (node.type === 'CallExpression') {
    if (node.callee?.type === 'MemberExpression' && node.callee.property?.name === '$resolve') {
      return node
    }
    return findResolveCall(node.callee?.object)
  }
  if (node.type === 'MemberExpression') {
    return findResolveCall(node.object)
  }
  return null
}
