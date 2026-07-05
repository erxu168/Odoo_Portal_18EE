'use client';

import React from 'react';

interface StatusBadgeProps {
  status: string;
}

const STATUS_MAP: Record<string, [string, string]> = {
  pending_approval: ['bg-amber-100 text-amber-800', 'Awaiting approval'],
  approved: ['bg-gray-100 text-gray-700', 'Approved'],
  sent: ['bg-orange-100 text-orange-800', 'Sent'],
  received: ['bg-green-100 text-green-800', 'Delivered'],
  partial: ['bg-amber-100 text-amber-800', 'Partial'],
  cancelled: ['bg-red-100 text-red-800', 'Cancelled'],
  draft: ['bg-gray-100 text-gray-700', 'Draft'],
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const [cls, label] = STATUS_MAP[status] || ['bg-gray-100 text-gray-700', status];
  return (
    <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold ${cls}`}>
      {label}
    </span>
  );
}
