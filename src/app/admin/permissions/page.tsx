'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import PermissionsMatrix from '@/components/admin/PermissionsMatrix';
import ModuleAccessMatrix from '@/components/admin/ModuleAccessMatrix';

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
  return (
    <>
      <AppHeader supertitle="ADMIN" title="Permissions" subtitle="Who gets what, per role" />
      {/* Two halves of one idea, in the order you'd ask the questions:
          can this role OPEN the app at all, and then what can they DO inside it. */}
      <div className="p-4 max-w-3xl mx-auto pb-0">
        <ModuleAccessMatrix />
        <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-t-2xl">
          <span className="text-[12px] font-bold uppercase tracking-wide text-gray-500">
            What they can do inside
          </span>
        </div>
      </div>
      <PermissionsMatrix />
    </>
  );
}
