import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppTabBar from '@/components/ui/AppTabBar';

export const metadata: Metadata = {
  title: 'Krawings Portal',
  description: 'SSAM Korean BBQ - Staff Portal',
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
    <html lang="en">
      <body className="antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white min-h-screen">
        <main className="max-w-lg mx-auto pb-20">{children}</main>
        <AppTabBar />
      </body>
    </html>
  );
}
