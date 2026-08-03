import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppTabBar from '@/components/ui/AppTabBar';
import AppTopBar from '@/components/ui/AppTopBar';
import MainWrapper from '@/components/ui/MainWrapper';
import { CompanyProvider } from '@/lib/company-context';
import DebugOverlay from '@/components/ui/DebugOverlay';
import { TopBarProvider } from '@/components/ui/TopBarContext';
import { ShiftProvider } from '@/lib/shift-context';
import StationGate from '@/components/ui/StationGate';
import KeyboardViewportManager from '@/components/ui/KeyboardViewportManager';
import NumpadProvider from '@/components/ui/NumpadProvider';
import RestartListener from '@/components/device/RestartListener';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Krawings Portal',
  description: 'SSAM Korean BBQ - Staff Portal',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#2563EB',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Derive the shared-tablet flag server-side so StationGate starts from an
  // authoritative value — never a client "unknown" state that could fail open
  // (expose tools un-PINned) or, if the lookup hangs, blank the whole portal.
  const stationShared = !!getCurrentUser()?.is_shared_device;
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white min-h-screen">
        <TopBarProvider>
        <CompanyProvider>
          <ShiftProvider>
            {/* StationGate sits OUTSIDE the shell so it can mark the shell `inert`
                while the PIN lock is up (blocks keyboard/AT access, not just
                visually), while its own lock/bar stay interactive. */}
            <StationGate serverShared={stationShared} />
            {/* Keeps the focused text field above the on-screen keyboard, portal-wide.
                Outside the shell so it also serves the PIN lock and other overlays. */}
            <KeyboardViewportManager />
            {/* Heartbeat for remote restart — outside the shell so it keeps polling
                even while a PIN lock has the shell inert. */}
            <RestartListener />
            {/* The one numpad host. Wraps the shell so any field can ask for it;
                it renders nothing until a field does. */}
            <NumpadProvider>
              <div id="kw-app-shell">
                <AppTopBar />
                <MainWrapper>{children}</MainWrapper>
                <AppTabBar />
                <DebugOverlay />
              </div>
            </NumpadProvider>
          </ShiftProvider>
        </CompanyProvider>
        </TopBarProvider>
      </body>
    </html>
  );
}
