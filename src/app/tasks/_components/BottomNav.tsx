'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/tasks/staff',         label: 'My Tasks', icon: '✅' },
  { href: '/tasks/staff/photos',  label: 'Photos',   icon: '📸' },
  { href: '/tasks/staff/profile', label: 'Profile',  icon: '👤' },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50 max-w-[430px] mx-auto">
      {NAV_ITEMS.map(item => {
        const active = path === item.href || path.startsWith(item.href + '/');
        return (
          <Link key={item.href} href={item.href} className="flex-1 flex flex-col items-center py-2 gap-0.5">
            <span className="text-lg">{item.icon}</span>
            <span className={`text-[10.5px] font-semibold ${active ? 'text-orange-500' : 'text-gray-400'}`}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
