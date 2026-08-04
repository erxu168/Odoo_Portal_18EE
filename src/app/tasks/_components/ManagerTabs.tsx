'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BASE_TABS = [
  { href: '/tasks/manager',           label: 'Dashboard', adminOnly: false },
  { href: '/tasks/manager/templates', label: 'Templates', adminOnly: false },
  { href: '/tasks/manager/training',  label: 'Guides',    adminOnly: false },
  { href: '/tasks/manager/review',    label: 'Review',    adminOnly: false },
  { href: '/tasks/admin',             label: 'Settings',  adminOnly: true  },
];

export default function ManagerTabs() {
  const path = usePathname();
  const [role, setRole] = useState<string>('staff');

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.role) setRole(d.user.role);
    }).catch(() => {});
  }, []);

  const tabs = BASE_TABS.filter(t => !t.adminOnly || role === 'admin');

  return (
    // top-9, not top-0: the app's blue top bar is `fixed top-0` (which is why
    // MainWrapper reserves pt-9). Sticking at 0 parked the tabs UNDERNEATH it and
    // sheared the labels in half as soon as the page scrolled.
    <nav className="sticky top-9 z-40 bg-white border-b border-gray-200 flex overflow-x-auto px-4 scrollbar-hide">
      {tabs.map(tab => {
        const active = path === tab.href;
        return (
          <Link key={tab.href} href={tab.href}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 h-11 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              active ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
