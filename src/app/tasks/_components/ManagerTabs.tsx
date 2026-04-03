'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/tasks/manager',           label: 'Dashboard' },
  { href: '/tasks/manager/shifts',    label: 'Shifts' },
  { href: '/tasks/manager/overdue',   label: 'Overdue',   badge: 'overdue' },
  { href: '/tasks/manager/photos',    label: 'Photos',    badge: 'photos' },
  { href: '/tasks/manager/templates', label: 'Templates' },
  { href: '/tasks/manager/history',   label: 'History' },
];

interface Props {
  overdueCount?: number;
  photosCount?: number;
}

export default function ManagerTabs({ overdueCount = 0, photosCount = 0 }: Props) {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-40 bg-white border-b border-gray-200 flex overflow-x-auto px-4 scrollbar-hide">
      {TABS.map(tab => {
        const active = path === tab.href;
        const count  = tab.badge === 'overdue' ? overdueCount : tab.badge === 'photos' ? photosCount : 0;
        return (
          <Link key={tab.href} href={tab.href}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 h-11 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              active ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}>
            {tab.label}
            {count > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
