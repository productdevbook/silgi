import { createElement } from 'react'

import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export const gitConfig = {
  user: 'productdevbook',
  repo: 'silgi',
  branch: 'main',
}

function Logo() {
  return createElement(
    'div',
    { className: 'flex items-center gap-2' },
    createElement(
      'svg',
      { viewBox: '0 0 32 32', className: 'w-6 h-6' },
      createElement('rect', { width: 32, height: 32, rx: 7, fill: '#edc462' }),
      createElement('circle', { cx: 16, cy: 16, r: 4, fill: '#0a0908' }),
    ),
    createElement('span', { className: 'font-semibold' }, 'Silgi'),
  )
}

function icon(d: string) {
  return createElement(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'size-4' },
    createElement('path', { d }),
  )
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: createElement(Logo),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'Docs',
        url: '/docs',
        active: 'nested-url',
        icon: icon('M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z'),
      },
      {
        text: 'Blog',
        url: '/blog',
        icon: icon('M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'),
      },
      {
        text: 'Changelog',
        url: '/changelog',
        icon: icon('M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'),
      },
      {
        text: 'Showcase',
        url: '/showcase',
        icon: icon('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7'),
      },
      {
        text: 'Sponsors',
        url: '/sponsors',
        icon: icon('M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z'),
      },
    ],
  }
}
