import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AppHeader from '@/components/ui/AppHeader';
import ManagerTabs from '../_components/ManagerTabs';
import SpawnTimeSettings from '../_components/SpawnTimeSettings';

export default function AdminPage() {
  const user = getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/tasks');

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="TASK MANAGER" title="Settings" />

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Notifications</p>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {[
              { label: 'Overdue task alerts',      desc: 'Notify manager when a task passes its deadline',     defaultOn: true  },
              { label: 'Photo review reminders',   desc: 'Alert when photos have been waiting more than 2h',  defaultOn: true  },
              { label: 'Shift completion summary', desc: 'Email manager when a shift ends with tasks missing', defaultOn: false },
            ].map((item, i, arr) => (
              <div key={item.label} className={`flex items-center justify-between px-4 py-3.5 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div>
                  <p className="font-semibold text-sm text-gray-800">{item.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked={item.defaultOn} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
              </div>
            ))}
          </div>
        </section>

        <SpawnTimeSettings />

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700">
          <p className="font-semibold mb-1">⚙️ Stored in Odoo</p>
          <p className="text-xs">The checklist creation time is saved on each company record in Odoo, so it stays in sync everywhere.</p>
        </div>
      </div>
    </div>
  );
}
