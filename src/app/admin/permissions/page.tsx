'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PermissionsMatrix from '@/components/admin/PermissionsMatrix';

export default function PermissionsPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setState(d.user?.role === 'admin' ? 'ok' : 'denied'))
      .catch(() => setState('denied'));
  }, []);

  if (state === 'loading') return <div className="p-6 text-gray-500">Loading…</div>;
  if (state === 'denied') {
    return (
      <div className="p-6">
        <p className="text-gray-700 mb-4">You need admin access to manage permissions.</p>
        <button onClick={() => router.push('/')} className="text-green-700 font-semibold">Back to home</button>
      </div>
    );
  }
  return <PermissionsMatrix />;
}
