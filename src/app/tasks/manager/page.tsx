import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getManagerDashboard } from '@/lib/odoo-tasks';
import ManagerTabs from '../_components/ManagerTabs';
import Link from 'next/link';

export default async function ManagerDashboard() {
  const user = getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'staff') redirect('/tasks/staff');

  const data = await getManagerDashboard();

  const stats = [
    { label: 'Active Shifts',    value: data.active_shifts,        color: 'text-orange-600', accent: 'border-orange-400', href: '/tasks/manager/shifts' },
    { label: 'Avg Completion',   value: `${data.avg_completion}%`, color: 'text-green-600',  accent: 'border-green-400',  href: '/tasks/manager/shifts' },
    { label: 'Overdue Tasks',    value: data.overdue_count,        color: 'text-red-600',    accent: 'border-red-400',    href: '/tasks/manager/overdue' },
    { label: 'Photos to Review', value: data.photos_pending,       color: 'text-amber-600',  accent: 'border-amber-400',  href: '/tasks/manager/photos' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-gray-400 hover:text-orange-500 transition-colors">← Dashboard</Link>
        <h1 className="font-bold text-gray-800">Shift Tasks</h1>
        <div className="w-16" />
      </div>

      <ManagerTabs overdueCount={data.overdue_count} photosCount={data.photos_pending} />

      <div className="max-w-2xl mx-auto px-4 py-5">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {stats.map(s => (
            <Link key={s.label} href={s.href}
              className={`bg-white rounded-2xl border-l-4 ${s.accent} p-4 shadow-sm hover:shadow-md transition-shadow`}>
              <p className={`text-3xl font-extrabold leading-none ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 font-medium mt-1.5">{s.label}</p>
            </Link>
          ))}
        </div>

        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Shifts today</p>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {data.shifts.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">No shifts scheduled today</div>
          ) : (
            data.shifts.map((shift, i) => (
              <Link key={shift.id} href={`/tasks/manager/shifts/${shift.id}`}
                className={`flex items-center justify-between px-4 py-3.5 hover:bg-orange-50/30 transition-colors ${i < data.shifts.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    shift.state === 'active' ? 'bg-green-500' :
                    shift.state === 'upcoming' ? 'bg-blue-300' : 'bg-gray-300'
                  }`} />
                  <div>
                    <p className="font-semibold text-sm text-gray-800">{shift.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{shift.employee_name}</p>
                  </div>
                </div>
                <span className={`text-sm font-bold ${
                  shift.completion_rate >= 80 ? 'text-green-600' : 'text-amber-500'
                }`}>
                  {shift.state === 'upcoming' ? '—' : `${shift.completion_rate}%`}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
