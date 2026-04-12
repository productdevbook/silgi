import { useMDXComponents } from '@/components/mdx'
import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import browserCollections from 'collections/browser'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { Suspense } from 'react'

export const Route = createFileRoute('/blog/$')({
  component: BlogPost,
  loader: async ({ params }) => {
    const slug = params._splat ?? ''
    const data = await blogLoader({ data: slug })
    await blogClientLoader.preload(data.path)
    return data
  },
})

const blogLoader = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const { blog } = await import('@/lib/source')
    const page = blog.getPage([slug])
    if (!page) throw notFound()

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description ?? '',
      author: ((page.data as Record<string, unknown>).author as string) ?? 'Silgi Team',
      date: String((page.data as Record<string, unknown>).date ?? ''),
    }
  })

const blogClientLoader = browserCollections.blogPosts.createClientLoader({
  component({ default: MDX }, props: { title: string; description: string; author: string; date: string }) {
    return (
      <article className='mx-auto w-full max-w-3xl px-4 py-16'>
        <Link
          to='/blog'
          className='mb-8 inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground hover:text-fd-primary'
        >
          <span aria-hidden>←</span> Back to blog
        </Link>
        <h1 className='mb-3 text-4xl font-bold tracking-tight'>{props.title}</h1>
        <p className='mb-2 text-fd-muted-foreground'>{props.description}</p>
        <div className='mb-10 flex items-center gap-3 text-sm text-fd-muted-foreground'>
          <span>{props.author}</span>
          <span>·</span>
          <span>
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

function BlogPost() {
  const data = Route.useLoaderData()

  return (
    <HomeLayout {...baseOptions()}>
      <Suspense>
        {blogClientLoader.useContent(data.path, {
          title: data.title,
          description: data.description,
          author: data.author,
          date: data.date,
        })}
      </Suspense>
    </HomeLayout>
  )
}
