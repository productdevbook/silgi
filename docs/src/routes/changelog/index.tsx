import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { HomeLayout } from 'fumadocs-ui/layouts/home'

export const Route = createFileRoute('/changelog/')({
  component: ChangelogIndex,
  loader: () => getChangelogPosts(),
})

const getChangelogPosts = createServerFn({ method: 'GET' }).handler(async () => {
  const { changelog } = await import('@/lib/source')
  return changelog
    .getPages()
    .map((p) => ({
      url: p.url,
      title: p.data.title,
      description: p.data.description ?? '',
      version: ((p.data as Record<string, unknown>).version as string) ?? p.data.title,
      date: String((p.data as Record<string, unknown>).date ?? ''),
    }))
    .toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

function ChangelogIndex() {
  const releases = Route.useLoaderData()

  return (
    <HomeLayout {...baseOptions()}>
      <div className='mx-auto w-full max-w-3xl px-4 py-16'>
        <h1 className='mb-2 text-4xl font-bold tracking-tight'>Changelog</h1>
        <p className='mb-12 text-fd-muted-foreground'>What's new in Silgi.</p>

        <div className='relative'>
          {/* Timeline line */}
          <div className='absolute left-[7px] top-0 h-full w-px bg-fd-border' />

          {releases.map((release, i) => (
            <div key={release.url} className='relative mb-12 pl-8 last:mb-0'>
              {/* Dot */}
              <div className='absolute left-0 top-1.5 size-[15px] rounded-full border-2 border-fd-border bg-fd-background' />
              {i === 0 && <div className='absolute left-[3px] top-[9px] size-[9px] rounded-full bg-fd-primary' />}

              {/* Content */}
              <div className='mb-1 flex items-baseline gap-3'>
                <h2 className='text-xl font-semibold'>{release.version}</h2>
                <span className='text-sm text-fd-muted-foreground'>
                  {new Date(release.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
              </div>
              <p className='mt-1 text-sm text-fd-muted-foreground'>{release.description}</p>

              <Link
                to={release.url}
                className='mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary hover:underline'
              >
                Read full changelog <span aria-hidden>→</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </HomeLayout>
  )
}
