import { defineEventHandler, getRouterParam, setResponseHeader, createError } from 'h3';
import { ImageResponse } from '@takumi-rs/image-response';
import { generate as DefaultImage } from 'fumadocs-ui/og/takumi';
import { source } from '../../../../src/lib/source';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? '';
  const slugs = slug
    .split('/')
    .filter((v: string) => v.length > 0)
    .slice(0, -1); // remove "image.webp"

  const page = source.getPage(slugs);
  if (!page) {
    throw createError({ statusCode: 404, message: 'Page not found' });
  }

  const response = new ImageResponse(
    DefaultImage({
      title: page.data.title,
      description: page.data.description,
      site: 'Katman',
    }),
    {
      width: 1200,
      height: 630,
      format: 'webp',
    },
  );

  // Forward the Response to nitro
  setResponseHeader(event, 'content-type', response.headers.get('content-type') ?? 'image/webp');
  setResponseHeader(event, 'cache-control', 'public, max-age=86400');
  return response.body;
});
