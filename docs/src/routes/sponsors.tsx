import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute } from '@tanstack/react-router'
import { HomeLayout } from 'fumadocs-ui/layouts/home'

export const Route = createFileRoute('/sponsors')({ component: SponsorsPage })

const SPONSOR_URL = 'https://github.com/sponsors/productdevbook'

interface Sponsor {
  name: string
  url: string
  image: string
}

const platinum: Sponsor[] = []
const gold: Sponsor[] = []
const silver: Sponsor[] = []

function SponsorsPage() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className='mx-auto w-full max-w-4xl px-4 py-16'>
        <div className='mb-12 text-center'>
          <h1 className='mb-3 text-4xl font-bold tracking-tight'>Sponsors</h1>
          <p className='mx-auto mb-8 max-w-lg text-fd-muted-foreground'>
            Silgi is open source and free to use. Sponsors help keep the project maintained and growing.
          </p>
          <a
            href={SPONSOR_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-2 rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground hover:bg-fd-primary/90'
          >
            Become a Sponsor
          </a>
        </div>

        <SponsorTier title='Platinum' sponsors={platinum} size='lg' />
        <SponsorTier title='Gold' sponsors={gold} size='md' />
        <SponsorTier title='Silver' sponsors={silver} size='sm' />

        {platinum.length + gold.length + silver.length === 0 && (
          <div className='flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center'>
            <p className='mb-2 text-lg font-medium'>Be the first sponsor</p>
            <p className='max-w-sm text-sm text-fd-muted-foreground'>
              Your logo will appear here and on the Silgi homepage.
            </p>
          </div>
        )}
      </div>
    </HomeLayout>
  )
}

function SponsorTier({ title, sponsors, size }: { title: string; sponsors: Sponsor[]; size: 'lg' | 'md' | 'sm' }) {
  if (sponsors.length === 0) return null

  const gridCols = size === 'lg' ? 'grid-cols-1 sm:grid-cols-2' : size === 'md' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-5'
  const h = size === 'lg' ? 'h-28' : size === 'md' ? 'h-20' : 'h-14'

  return (
    <div className='mb-10'>
      <h2 className='mb-4 text-xs font-semibold uppercase tracking-widest text-fd-muted-foreground'>{title}</h2>
      <div className={`grid gap-3 ${gridCols}`}>
        {sponsors.map((s) => (
          <a
            key={s.name}
            href={s.url}
            target='_blank'
            rel='noopener noreferrer'
            className={`flex items-center justify-center rounded-xl border bg-fd-card ${h} p-4 transition-colors hover:bg-fd-accent/5`}
          >
            <img src={s.image} alt={s.name} className='max-h-full max-w-full object-contain' />
          </a>
        ))}
      </div>
    </div>
  )
}
