import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AppHeader from '@/components/ui/AppHeader';
import ManagerTabs from '../_components/ManagerTabs';
import SpawnTimeSettings from '../_components/SpawnTimeSettings';
import SummarySettings from '../_components/SummarySettings';
import ServiceTimesSettings from '../_components/ServiceTimesSettings';

export default function AdminPage() {
  const user = getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/tasks');

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="TASK MANAGER" title="Settings" showBack backHref="/tasks/manager" />

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        <ServiceTimesSettings />

        <SummarySettings />

        <SpawnTimeSettings />

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-[var(--fs-sm)] text-blue-700">
          <p className="font-semibold mb-1">⚙️ Stored in Odoo</p>
          <p className="text-[var(--fs-xs)]">These settings are saved on each company record in Odoo, so they stay in sync everywhere.</p>
        </div>
      </div>
    </div>
  );
}
