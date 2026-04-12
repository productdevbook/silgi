export const metadata = {
  title: 'Silgi + Next.js',
  description: 'Silgi RPC with Next.js App Router',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  )
}
