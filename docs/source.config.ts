import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins'
import { pageSchema } from 'fumadocs-core/source/schema'
import { defineCollections, defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { transformerTwoslash } from 'fumadocs-twoslash'
import { createFileSystemTypesCache } from 'fumadocs-twoslash/cache-fs'
import { z } from 'zod'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export const blogPosts = defineCollections({
  type: 'doc',
  dir: 'content/blog',
  schema: pageSchema.extend({
    author: z.string().default('Silgi Team'),
    date: z.string().date().or(z.date()),
  }),
})

export const changelogPosts = defineCollections({
  type: 'doc',
  dir: 'content/changelog',
  schema: pageSchema.extend({
    date: z.string().date().or(z.date()),
    version: z.string(),
  }),
})

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerTwoslash({
          typesCache: createFileSystemTypesCache(),
        }),
      ],
    },
  },
})
