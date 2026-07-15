'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import StaffPeople from '@/components/admin/StaffPeople';
import PermissionsMatrix from '@/components/admin/PermissionsMatrix';

/**
 * Unified Staff module — one place to manage people AND their access.
 *  - People: real HR staff, invite to portal, and per-person access controls
 *    (role, companies, modules, PIN, activate/deactivate). Replaces the old
 *    "Manage Staff" (/admin/users) and "Staff access" (/admin/staff-access).
 *  - Access rules: the role-level permission matrix (was "Permissions").
 */
export default function StaffModulePage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [tab, setTab] = useState<'people' | 'rules'>('people');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setState(d.user?.role === 'admin' ? 'ok' : 'denied'))
      .catch(() => setState('denied'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex justify-center pt-24">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-700 mb-4">You need admin access to manage staff.</p>
        <button onClick={() => router.push('/')} className="text-green-700 font-semibold">Back to home</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="ADMIN" title="Staff" subtitle="People & access in one place" />

      <div className="flex gap-1.5 px-4 py-3">
        <button onClick={() => setTab('people')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'people' ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          People
        </button>
        <button onClick={() => setTab('rules')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'rules' ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Access rules
        </button>
      </div>

      {tab === 'people' ? (
        <StaffPeople />
      ) : (
        <div className="pb-24">
          <PermissionsMatrix />
        </div>
      )}
    </div>
  );
}
