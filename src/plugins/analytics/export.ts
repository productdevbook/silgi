/**
 * Markdown export for analytics entries.
 */

import { redactHeaderValue, round, safeStringify } from './utils.ts'

import type { ErrorEntry, RequestEntry } from './types.ts'

export function errorToMarkdown(e: ErrorEntry): string {
  const time = new Date(e.timestamp).toISOString()
  const inputJson = safeStringify(e.input)

  let md = `## Error in \`${e.procedure}\`\n\n`
  md += `**Time:** ${time}  \n`
  md += `**Error:** ${e.code}  \n`
  md += `**Status:** ${e.status}  \n`
  md += `**Duration:** ${e.durationMs}ms\n\n`

  if (e.input !== undefined) {
    md += `### Input\n\n\`\`\`json\n${inputJson}\n\`\`\`\n\n`
  }

  if (e.stack) {
    md += `### Stack Trace\n\n\`\`\`\n${e.stack}\n\`\`\`\n\n`
  }

  if (Object.keys(e.headers).length > 0) {
    md += `### Request Headers\n\n`
    for (const [k, v] of Object.entries(e.headers)) {
      md += `- \`${k}\`: \`${redactHeaderValue(k, v)}\`\n`
    }
    md += '\n'
  }

  if (e.spans.length > 0) {
    md += `### Traced Operations\n\n`
    for (let i = 0; i < e.spans.length; i++) {
      const s = e.spans[i]!
      const errMark = s.error ? ` ❌ ${s.error}` : ''
      md += `**${i + 1}. [${s.kind}] ${s.name}** — ${s.durationMs}ms${errMark}\n`
      if (s.detail) md += `\`\`\`\n${s.detail}\n\`\`\`\n`
    }
    md += '\n'
  }

  md += `### Error Message\n\n\`\`\`\n${e.error}\n\`\`\``
  return md
}

export function requestToMarkdown(r: RequestEntry): string {
  const time = new Date(r.timestamp).toISOString()
  const emoji = r.status >= 500 ? '💥' : r.status >= 400 ? '⚠️' : '✅'

  let md = `## ${emoji} ${r.method} ${r.path} → ${r.status} (${r.durationMs}ms)\n\n`
  md += `| Field | Value |\n|-------|-------|\n`
  md += `| Request ID | \`${r.requestId}\` |\n`
  md += `| Session ID | \`${r.sessionId}\` |\n`
  md += `| Method | ${r.method} |\n`
  md += `| URL | \`${r.url}\` |\n`
  md += `| Path | \`${r.path}\` |\n`
  md += `| Status | ${r.status} |\n`
  md += `| Duration | ${r.durationMs}ms |\n`
  md += `| Time | ${time} |\n`
  md += `| IP | ${r.ip} |\n`
  md += `| Procedures | ${r.procedures.length} |\n`
  if (r.isBatch) md += `| Batch | Yes |\n`
  md += '\n'

  for (let i = 0; i < r.procedures.length; i++) {
    const p = r.procedures[i]!
    const pEmoji = p.status >= 400 ? '⚠️' : '✅'
    md += `### ${pEmoji} ${i + 1}. \`${p.procedure}\` → ${p.status} (${p.durationMs}ms)\n\n`

    if (p.input !== undefined && p.input !== null) {
      md += `#### Input\n\n\`\`\`json\n${safeStringify(p.input)}\n\`\`\`\n\n`
    }

    if (p.output !== undefined && p.output !== null) {
      md += `#### Output\n\n\`\`\`json\n${safeStringify(p.output)}\n\`\`\`\n\n`
    }

    if (p.spans.length > 0) {
      // Timing by kind
      const byKind = new Map<string, number>()
      for (const s of p.spans) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
      const tracedMs = [...byKind.values()].reduce((a, b) => a + b, 0)
      const appMs = Math.max(0, p.durationMs - tracedMs)
      const total = Math.max(p.durationMs, 0.1)

      md += `#### Timing\n\n| Category | Duration | % |\n|----------|----------|---|\n`
      md += `| **Total** | **${p.durationMs}ms** | 100% |\n`
      for (const [kind, ms] of byKind) md += `| ${kind} | ${round(ms)}ms | ${round((ms / total) * 100)}% |\n`
      md += `| App Logic | ${round(appMs)}ms | ${round((appMs / total) * 100)}% |\n\n`

      for (let j = 0; j < p.spans.length; j++) {
        const s = p.spans[j]!
        const offset = s.startOffsetMs != null ? ` (at +${s.startOffsetMs}ms)` : ''
        const err = s.error ? ` ❌ ${s.error}` : ''
        md += `**${j + 1}. [${s.kind}] ${s.name}** — ${s.durationMs}ms${offset}${err}\n`
        if (s.detail) md += `\`\`\`\n${s.detail}\n\`\`\`\n`
      }
      md += '\n'
    }

    if (p.error) md += `#### Error\n\n\`\`\`\n${p.error}\n\`\`\`\n\n`
  }

  md += `---\n\n**Analyze this request and suggest performance optimizations:**\n`
  md += `- Redundant or slow operations that could be combined?\n`
  md += `- N+1 query pattern?\n`
  md += `- Data that should be cached?\n`
  md += `- Sequential calls that could run in parallel?\n`
  if (r.durationMs > 100) md += `- ⚠️ This request took ${r.durationMs}ms — what is the bottleneck?\n`

  return md
}
