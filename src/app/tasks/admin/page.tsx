import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Link from 'next/link';

export default function AdminPage() {
  const user = getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/tasks');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-gray-400 hover:text-orange-500 transition-colors">← Dashboard</Link>
        <h1 className="font-bold text-gray-800">Task Management — Admin</h1>
        <div className="w-16" />
      </div>

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

        <section>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Cron schedule</p>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Deadline check interval</label>
              <div className="flex gap-2">
                <input type="number" defaultValue={5} className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option>minutes</option><option>hours</option>
                </select>
              </div>
            </div>
            <button className="bg-orange-500 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-orange-600 transition-colors">
              Save Settings
            </button>
          </div>
        </section>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700">
          <p className="font-semibold mb-1">⚙️ Stored in Odoo</p>
          <p className="text-xs">Settings are persisted as <code className="font-mono bg-blue-100 px-1 rounded">ir.config_parameter</code> key-value pairs on Odoo 18 EE.</p>
        </div>
      </div>
    </div>
  );
}
