import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { HomeLayout } from 'fumadocs-ui/layouts/home'

export const Route = createFileRoute('/blog/')({
  component: BlogIndex,
  loader: () => getBlogPosts(),
})

const getBlogPosts = createServerFn({ method: 'GET' }).handler(async () => {
  const { blog } = await import('@/lib/source')
  return blog
    .getPages()
    .map((p) => ({
      url: p.url,
      title: p.data.title,
      description: p.data.description ?? '',
      author: (p.data as Record<string, unknown>).author as string ?? 'Silgi Team',
      date: String((p.data as Record<string, unknown>).date ?? ''),
    }))
    .toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

function BlogIndex() {
  const posts = Route.useLoaderData()

  return (
    <HomeLayout {...baseOptions()}>
      <div className='mx-auto w-full max-w-3xl px-4 py-16'>
        <h1 className='mb-2 text-4xl font-bold tracking-tight'>Blog</h1>
        <p className='mb-12 text-fd-muted-foreground'>News and updates from the Silgi team.</p>

        <div className='flex flex-col gap-1'>
          {posts.map((post) => (
            <Link
              key={post.url}
              to={post.url}
              className='group -mx-4 flex items-baseline justify-between gap-4 rounded-lg px-4 py-4 transition-colors hover:bg-fd-accent/5'
            >
              <div className='min-w-0'>
                <h2 className='font-semibold group-hover:text-fd-primary'>{post.title}</h2>
                <p className='mt-1 truncate text-sm text-fd-muted-foreground'>{post.description}</p>
              </div>
              <span className='shrink-0 text-sm tabular-nums text-fd-muted-foreground'>
                {new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </HomeLayout>
  )
}
