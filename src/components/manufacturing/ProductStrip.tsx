'use client';

import React from 'react';

interface ProductStripProps {
  /** Main label -- product name on detail screens, category label on list/dashboard screens */
  label: string;
  /** Optional small line below (e.g., product code, supplier) */
  subtitle?: string;
}

const ProductIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

export default function ProductStrip({ label, subtitle }: ProductStripProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-2 min-h-[44px]">
      <span className="text-gray-400 flex-shrink-0">
        <ProductIcon />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-gray-900 truncate">{label}</div>
        {subtitle && <div className="text-xs text-gray-500 truncate">{subtitle}</div>}
      </div>
    </div>
  );
}
