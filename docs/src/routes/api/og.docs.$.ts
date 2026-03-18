import { createFileRoute } from '@tanstack/react-router';
import { ImageResponse } from '@takumi-rs/image-response';
import { generate as DefaultImage } from 'fumadocs-ui/og/takumi';
import { source } from '@/lib/source';

export const Route = createFileRoute('/api/og/docs/$')({
  server: {
    handlers: {
      GET: ({ params }: { params: { _splat?: string } }) => {
        const slugs = (params._splat ?? '')
          .split('/')
          .filter((v: string) => v.length > 0)
          .slice(0, -1);

        const page = source.getPage(slugs);
        if (!page) return new Response('Not found', { status: 404 });

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
      },
    },
  },
});
