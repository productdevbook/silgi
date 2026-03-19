import SearchDialog from '@/components/search'
import appCss from '@/styles/app.css?url'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import * as React from 'react'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Katman — Type-safe RPC for TypeScript' },
      {
        name: 'description',
        content: 'Type-safe RPC framework for TypeScript. Compiled pipelines, single package, every runtime.',
      },
      { name: 'theme-color', content: '#0a0908' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Katman — Type-safe RPC for TypeScript' },
      {
        property: 'og:description',
        content: 'Type-safe RPC framework for TypeScript. Compiled pipelines, single package, every runtime.',
      },
      { property: 'og:image', content: '/og.png' },
      { property: 'og:site_name', content: 'Katman' },
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Katman — Type-safe RPC for TypeScript' },
      {
        name: 'twitter:description',
        content: 'Type-safe RPC framework for TypeScript. Compiled pipelines, single package, every runtime.',
      },
      { name: 'twitter:image', content: '/og.png' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className='flex flex-col min-h-screen'>
        <RootProvider search={{ SearchDialog }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
