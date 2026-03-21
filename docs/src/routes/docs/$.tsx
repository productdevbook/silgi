import { useMDXComponents } from "@/components/mdx";
import { baseOptions, gitConfig } from "@/lib/layout.shared";
import { getPageImage } from "@/lib/og";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import browserCollections from "collections/browser";
// staticFunctionMiddleware removed — causes serialization issues on Cloudflare
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { Suspense } from "react";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await loader({ data: slugs });
    await clientLoader.preload(data.path);
    return data;
  },
});

const loader = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const { source } = await import("@/lib/source");
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      slugs: Array.from(page.slugs),
      path: page.path,
      pageTree: JSON.parse(
        JSON.stringify(await source.serializePageTree(source.getPageTree())),
      ),
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    // you can define props for the component
    {
      markdownUrl,
      path,
      slugs,
    }: {
      markdownUrl: string;
      path: string;
      slugs: string[];
    },
  ) {
    return (
      <DocsPage toc={toc}>
        <title>{`${frontmatter.title} — Silgi`}</title>
        <meta name="description" content={frontmatter.description} />
        <meta property="og:title" content={frontmatter.title} />
        <meta property="og:description" content={frontmatter.description} />
        <meta property="og:image" content={getPageImage(slugs).url} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={getPageImage(slugs).url} />
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${path}`}
          />
        </div>
        <DocsBody>
          <MDX components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

function Page() {
  const { pageTree, slugs, path } = useFumadocsLoader(Route.useLoaderData());
  const markdownUrl = `/llms.mdx/docs/${[...slugs, "index.mdx"].join("/")}`;

  return (
    <DocsLayout
      {...baseOptions()}
      tree={pageTree}
      sidebar={{ defaultOpenLevel: 1 }}
    >
      <Link to={markdownUrl} hidden />
      <Suspense>
        {clientLoader.useContent(path, { markdownUrl, path, slugs })}
      </Suspense>
    </DocsLayout>
  );
}
