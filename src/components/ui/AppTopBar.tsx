'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import CompanySelector from './CompanySelector';

/**
 * Thin persistent top bar showing the active company.
 * Hidden on auth pages. Sits above all page headers.
 */
export default function AppTopBar() {
  const pathname = usePathname();

  if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/reset-password') {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 max-w-lg mx-auto">
      <div className="bg-[#1A1F2E] flex items-center justify-end px-4 py-1.5 border-b border-white/10">
        <CompanySelector />
      </div>
    </div>
  );
}
