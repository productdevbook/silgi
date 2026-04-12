import { ImageResponse } from '@takumi-rs/image-response'
import { defineEventHandler, getRouterParam, setResponseHeader, createError } from 'h3'

import { source } from '../../../../src/lib/source'

function SilgiOG({ title, description }: { title: string; description?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0908',
        padding: '64px',
        fontFamily: 'Geist, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          top: '-80px',
          left: '50%',
          width: '700px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(237,196,98,0.06) 0%, transparent 70%)',
          transform: 'translateX(-50%)',
        }}
      />

      {/* Strata lines */}
      <div
        style={{
          position: 'absolute',
          top: '210px',
          left: 0,
          right: 0,
          height: '1px',
          backgroundColor: 'rgba(255,255,255,0.04)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '420px',
          left: 0,
          right: 0,
          height: '1px',
          backgroundColor: 'rgba(255,255,255,0.04)',
        }}
      />

      {/* Logo + site name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '48px',
        }}
      >
        {/* Gold rounded square */}
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            backgroundColor: '#edc462',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              backgroundColor: '#0a0908',
            }}
          />
        </div>
        <span
          style={{
            fontSize: '28px',
            fontWeight: 500,
            color: '#b5a892',
            letterSpacing: '-0.02em',
          }}
        >
          Silgi
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: title.length > 30 ? '64px' : '76px',
          fontWeight: 700,
          color: '#ede6db',
          lineHeight: 1.05,
          letterSpacing: '-0.03em',
          marginBottom: '24px',
          maxWidth: '900px',
        }}
      >
        {title}
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            fontSize: '32px',
            fontWeight: 400,
            color: '#7a6e60',
            lineHeight: 1.4,
            maxWidth: '800px',
          }}
        >
          {description}
        </div>
      )}

      {/* Bottom bar */}
      <div
        style={{
          position: 'absolute',
          bottom: '64px',
          left: '64px',
          right: '64px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '18px',
            color: '#5e5549',
            fontFamily: 'Geist Mono, monospace',
            letterSpacing: '0.1em',
          }}
        >
          DOCS
        </span>
        <span style={{ fontSize: '18px', color: '#5e5549' }}>silgi.productdevbook.com</span>
      </div>

      {/* Border */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '0px',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const slugs = slug
    .split('/')
    .filter((v: string) => v.length > 0)
    .slice(0, -1)

  const page = source.getPage(slugs)
  if (!page) {
    throw createError({ statusCode: 404, message: 'Page not found' })
  }

  const response = new ImageResponse(<SilgiOG title={page.data.title} description={page.data.description} />, {
    width: 1200,
    height: 630,
    format: 'webp',
  })

  setResponseHeader(event, 'content-type', response.headers.get('content-type') ?? 'image/webp')
  setResponseHeader(event, 'cache-control', 'public, max-age=86400')
  return response.body
})
