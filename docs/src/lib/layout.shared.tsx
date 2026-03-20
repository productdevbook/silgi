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

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: createElement(Logo),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'Documentation',
        url: '/docs',
        active: 'nested-url',
      },
    ],
  }
}
