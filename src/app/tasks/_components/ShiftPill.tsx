'use client';

import { Shift } from '@/lib/odoo-tasks';

interface Props {
  shift: Shift;
  selected: boolean;
  onClick: () => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function ShiftPill({ shift, selected, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={`
        flex items-center justify-between px-4 py-3.5 rounded-2xl border mb-2.5
        cursor-pointer transition-all
        ${selected ? 'border-orange-400 bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-orange-200'}
      `}
    >
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          shift.state === 'active'   ? 'bg-green-500' :
          shift.state === 'upcoming' ? 'bg-blue-300'  : 'bg-gray-300'
        }`} />
        <div>
          <p className="font-bold text-sm text-gray-800">{shift.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatTime(shift.start)} – {formatTime(shift.end)}
            {shift.state === 'active' && shift.overdue_count > 0
              ? ` · ${shift.overdue_count} overdue`
              : shift.state === 'upcoming' ? ' · Not started' : ''}
          </p>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        {shift.state === 'active' && (
          <>
            <p className={`text-base font-extrabold ${shift.completion_rate >= 80 ? 'text-green-600' : 'text-amber-500'}`}>
              {shift.completion_rate}%
            </p>
            <p className="text-xs text-gray-400">done</p>
          </>
        )}
        {shift.state === 'upcoming' && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Upcoming</span>
        )}
        {shift.state === 'done' && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Done</span>
        )}
      </div>
    </div>
  );
}
