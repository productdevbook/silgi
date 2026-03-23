import { blogPosts, changelogPosts, docs } from 'collections/server'
import { loader } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'
import { toFumadocsSource } from 'fumadocs-mdx/runtime/server'

import type { InferPageType } from 'fumadocs-core/source'

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: '/docs',
  plugins: [lucideIconsPlugin()],
})

export const blog = loader({
  source: toFumadocsSource(blogPosts, []),
  baseUrl: '/blog',
})

export const changelog = loader({
  source: toFumadocsSource(changelogPosts, []),
  baseUrl: '/changelog',
})

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed')

  return `# ${page.data.title}

${processed}`
}
