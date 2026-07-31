'use client';

/**
 * /waste — the Waste Tracker entry screen ("Something binned").
 *
 * Its own URL on purpose: it is opened from the shared department tablet's
 * home tile, and a screen with no URL cannot be deep-linked or browser-tested
 * (the counting screens taught us that).
 */
import React, { useState, useEffect } from 'react';
import WasteTracker from '@/components/inventory/WasteTracker';

export default function WastePage() {
  const [userRole, setUserRole] = useState<string>('staff');

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role);
    }).catch(() => {});
  }, []);

  return <WasteTracker userRole={userRole} />;
}
