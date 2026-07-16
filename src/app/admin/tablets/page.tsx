'use client';

import React from 'react';
import AppHeader from '@/components/ui/AppHeader';
import SharedTabletsSection from '@/components/admin/SharedTabletsSection';

export default function AdminTabletsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="MANAGER" title="Shared Tablets" />
      <div className="px-4 py-4 pb-24">
        <SharedTabletsSection />
      </div>
    </div>
  );
}
