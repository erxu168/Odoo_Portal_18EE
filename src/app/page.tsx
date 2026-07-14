import DashboardHome from '@/components/dashboard/DashboardHome';
import StationHome from '@/components/dashboard/StationHome';
import { getCurrentUser } from '@/lib/auth';

export default function Home() {
  // Shared department tablets (e.g. the kitchen station) get a focused,
  // Tasks-first home; personal phones keep the full dashboard.
  const user = getCurrentUser();
  if (user?.is_shared_device) return <StationHome />;
  return <DashboardHome />;
}
