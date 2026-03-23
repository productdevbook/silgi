import { useMDXComponents } from '@/components/mdx'
import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import browserCollections from 'collections/browser'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { Suspense } from 'react'

export const Route = createFileRoute('/changelog/$')({
  component: ChangelogPost,
  loader: async ({ params }) => {
    const slug = params._splat ?? ''
    const data = await changelogLoader({ data: slug })
    await changelogClientLoader.preload(data.path)
    return data
  },
})

const changelogLoader = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const { changelog } = await import('@/lib/source')
    const page = changelog.getPage([slug])
    if (!page) throw notFound()

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description ?? '',
      version: ((page.data as Record<string, unknown>).version as string) ?? page.data.title,
      date: String((page.data as Record<string, unknown>).date ?? ''),
    }
  })

const changelogClientLoader = browserCollections.changelogPosts.createClientLoader({
  component({ default: MDX }, props: { title: string; version: string; date: string }) {
    return (
      <article className='mx-auto w-full max-w-3xl px-4 py-16'>
        <Link
          to='/changelog'
          className='mb-8 inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground hover:text-fd-primary'
        >
          <span aria-hidden>←</span> All releases
        </Link>
        <div className='mb-8'>
          <h1 className='mb-2 text-4xl font-bold tracking-tight'>{props.version}</h1>
          <span className='text-sm text-fd-muted-foreground'>
            {new Date(props.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <div className='prose min-w-0'>
          <MDX components={useMDXComponents()} />
        </div>
      </article>
    )
  },
})

function ChangelogPost() {
  const data = Route.useLoaderData()

  return (
    <HomeLayout {...baseOptions()}>
      <Suspense>
        {changelogClientLoader.useContent(data.path, {
          title: data.title,
          version: data.version,
          date: data.date,
        })}
      </Suspense>
    </HomeLayout>
  )
}
