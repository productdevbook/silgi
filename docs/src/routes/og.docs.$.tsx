import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { ImageResponse } from '@takumi-rs/image-response';
import { generate as DefaultImage } from 'fumadocs-ui/og/takumi';
import { source } from '@/lib/source';

const ogLoader = createServerFn({ method: 'GET' })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const slugs = slug
      .split('/')
      .filter((v) => v.length > 0)
      .slice(0, -1); // remove "image.webp"

    const page = source.getPage(slugs);
    if (!page) throw new Response(undefined, { status: 404 });

    return new ImageResponse(
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
  });

export const Route = createFileRoute('/og/docs/$')({
  component: () => null,
  loader: async ({ params }) => {
    return ogLoader({ data: params._splat ?? '' });
  },
});
