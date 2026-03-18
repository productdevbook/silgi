import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { RootProvider } from 'fumadocs-ui/provider/react-router';
import './app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Type-safe RPC framework for TypeScript. Compiled pipelines, single package, every runtime." />
        <meta name="theme-color" content="#0a0908" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Katman — Type-safe RPC for TypeScript" />
        <meta property="og:description" content="Type-safe RPC framework for TypeScript. Compiled pipelines, single package, every runtime." />
        <meta property="og:image" content="/og.svg" />
        <meta property="og:site_name" content="Katman" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Katman — Type-safe RPC for TypeScript" />
        <meta name="twitter:image" content="/og.svg" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
