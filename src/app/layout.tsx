import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Krawings Portal',
  description: 'SSAM Korean BBQ - Manufacturing Portal',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1A1F2E',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white min-h-screen">
        <main className="max-w-lg mx-auto">{children}</main>
      </body>
    </html>
  );
}
