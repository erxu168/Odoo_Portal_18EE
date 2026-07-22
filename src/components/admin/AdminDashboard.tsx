'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';

/**
 * Admin home — the module landing for /admin (there was none; the route 404'd and
 * admin tools were reachable only via the hamburger drawer). Standard design:
 * white ActionCard tiles + a KPI row that surfaces the one thing needing an admin
 * (pending self-registrations). Every tile is an existing admin section; the
 * superseded /admin/users and /admin/staff-access are deliberately NOT relinked.
 */

interface Tile {
  id: string;
  emoji: string;
  label: string;
  sub: string;
  href: string;
  badge?: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [devices, setDevices] = useState(0);

  useEffect(() => {
    fetch('/api/admin/registrations?status=pending')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setPending(d.pending_count ?? (d.users?.length || 0)); })
      .catch(() => {});
    fetch('/api/admin/devices')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDevices((d.devices || []).length); })
      .catch(() => {});
  }, []);

  const tiles: Tile[] = [
    { id: 'staff', emoji: '\u{1F464}', label: 'Staff', sub: 'Invite & manage access', href: '/admin/staff', badge: pending > 0 ? String(pending) : undefined },
    { id: 'access', emoji: '\u{1F6E1}\u{FE0F}', label: 'Access rules', sub: 'Role × action permissions', href: '/admin/permissions' },
    { id: 'tablets', emoji: '\u{1F4F1}', label: 'Tablets & Devices', sub: 'Access & remote restart', href: '/admin/tablets' },
    { id: 'credentials', emoji: '\u{1F511}', label: 'Supplier Logins', sub: 'Vendor login vault', href: '/admin/credentials' },
    { id: 'settings', emoji: '⚙️', label: 'Settings', sub: 'Email, reminders & tolerance', href: '/admin/settings' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Administration" subtitle="Portal setup & access" />

      <div className="px-5 py-5 space-y-5">
        <KpiRow columns={2}>
          <KpiChip value={pending} label="Pending reg" tone={pending > 0 ? 'danger' : 'default'} />
          <KpiChip value={devices} label="Devices" />
        </KpiRow>

        <ActionGrid<Tile>
          items={tiles}
          getItemId={(t) => t.id}
          renderItem={(t) => (
            <ActionCard
              emoji={t.emoji}
              label={t.label}
              subtitle={t.sub}
              badge={t.badge ? { value: t.badge, tone: 'danger', ariaLabel: `${t.badge} pending registrations` } : undefined}
              onClick={() => router.push(t.href)}
            />
          )}
        />
      </div>
    </div>
  );
}
