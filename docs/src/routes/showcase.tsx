import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute } from '@tanstack/react-router'
import { HomeLayout } from 'fumadocs-ui/layouts/home'

export const Route = createFileRoute('/showcase')({ component: ShowcasePage })

interface ShowcaseItem {
  name: string
  description: string
  url: string
  image?: string
}

const projects: ShowcaseItem[] = [
  // Add projects here as they appear:
  // { name: 'Project Name', description: 'What it does', url: 'https://...', image: '/showcase/project.png' },
]

function ShowcasePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className='mx-auto w-full max-w-5xl px-4 py-16'>
        <h1 className='mb-2 text-4xl font-bold tracking-tight'>Showcase</h1>
        <p className='mb-12 text-fd-muted-foreground'>Projects built with Silgi.</p>

        {projects.length === 0 ? (
          <div className='flex flex-col items-center justify-center rounded-xl border border-dashed py-24 text-center'>
            <p className='mb-2 text-lg font-medium'>No projects yet</p>
            <p className='mb-6 max-w-sm text-sm text-fd-muted-foreground'>
              Building something with Silgi? Open a PR to add your project here.
            </p>
            <a
              href='https://github.com/productdevbook/silgi/edit/main/docs/src/routes/showcase.tsx'
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-1.5 rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground hover:bg-fd-primary/90'
            >
              Add your project
            </a>
          </div>
        ) : (
          <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
            {projects.map((project) => (
              <a
                key={project.name}
                href={project.url}
                target='_blank'
                rel='noopener noreferrer'
                className='group overflow-hidden rounded-xl border bg-fd-card transition-colors hover:bg-fd-accent/5'
              >
                {project.image && (
                  <div className='aspect-video overflow-hidden border-b bg-fd-muted'>
                    <img src={project.image} alt={project.name} className='size-full object-cover' />
                  </div>
                )}
                <div className='p-5'>
                  <h3 className='font-semibold group-hover:text-fd-primary'>{project.name}</h3>
                  <p className='mt-1 text-sm text-fd-muted-foreground'>{project.description}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </HomeLayout>
  )
}
