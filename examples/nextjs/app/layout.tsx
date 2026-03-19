export const metadata = {
  title: "Katman + Next.js",
  description: "Katman RPC with Next.js App Router",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
