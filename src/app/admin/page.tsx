'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminDashboard from '@/components/admin/AdminDashboard';

/**
 * /admin landing. Admin-only: non-admins are sent home (features invisible to a
 * role must be fully hidden). Client-gated the same way as the admin sub-pages.
 */
export default function AdminPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setState(d.user?.role === 'admin' ? 'ok' : 'denied'))
      .catch(() => setState('denied'));
  }, []);

  useEffect(() => {
    if (state === 'denied') router.replace('/');
  }, [state, router]);

  if (state !== 'ok') {
    return (
      <div className="min-h-screen bg-gray-50 flex justify-center pt-24">
        <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <AdminDashboard />;
}
