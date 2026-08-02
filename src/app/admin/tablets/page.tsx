'use client';

import React from 'react';
import AppHeader from '@/components/ui/AppHeader';
import StationAccountsSection from '@/components/admin/StationAccountsSection';
import SharedTabletsSection from '@/components/admin/SharedTabletsSection';
import DeviceRestartSection from '@/components/admin/DeviceRestartSection';

export default function AdminTabletsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="MANAGER" title="Tablets & Devices" />
      <div className="px-4 py-4 pb-24">
        <StationAccountsSection />
        <SharedTabletsSection />
        <DeviceRestartSection />
      </div>
    </div>
  );
}
