import { redirect } from 'next/navigation';
import { getCurrentUser, hasRole } from '@/lib/auth';
import SalesDashboard from '@/components/waj-sales/SalesDashboard';

/**
 * What a Jerk — Sales dashboard. Owner + managers only.
 * The API routes enforce the same rule server-side; this guard just keeps
 * non-managers from ever loading the screen.
 */
export default function SalesPage() {
  const user = getCurrentUser();
  if (!user) redirect('/login');
  if (!hasRole(user, 'manager')) redirect('/');
  return <SalesDashboard />;
}
