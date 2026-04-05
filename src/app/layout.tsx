import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppTabBar from '@/components/ui/AppTabBar';
import AppTopBar from '@/components/ui/AppTopBar';
import MainWrapper from '@/components/ui/MainWrapper';
import { CompanyProvider } from '@/lib/company-context';
import DebugOverlay from '@/components/ui/DebugOverlay';
import { TopBarProvider } from '@/components/ui/TopBarContext';

export const metadata: Metadata = {
  title: 'Krawings Portal',
  description: 'Krawings - Staff Portal',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563EB',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white min-h-screen">
        <TopBarProvider>
        <CompanyProvider>
          <AppTopBar />
          <MainWrapper>{children}</MainWrapper>
          <AppTabBar />
          <DebugOverlay />
        </CompanyProvider>
        </TopBarProvider>
      </body>
    </html>
  );
}
