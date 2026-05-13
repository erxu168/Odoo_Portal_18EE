'use client';

import React, { useState, useEffect } from 'react';
import ReportsHome from '@/components/reports/ReportsHome';

export default function ReportsPage() {
  const [userRole, setUserRole] = useState<string>('staff');

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.role) setUserRole(d.user.role);
    }).catch(() => {});
  }, []);

  return <ReportsHome userRole={userRole} />;
}
