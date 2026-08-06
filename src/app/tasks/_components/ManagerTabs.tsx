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
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 h-11 text-[var(--fs-sm)] font-semibold border-b-2 transition-colors whitespace-nowrap ${
              // Green, not blue. Blue is the module header and nothing else;
              // green is the portal's one "you are here / this is chosen" colour,
              // so a manager moving between Inventory and Tasks reads the same
              // signal in both. This underline sat directly beneath the blue
              // header, saying it in the header's own colour.
              active ? 'border-green-600 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
