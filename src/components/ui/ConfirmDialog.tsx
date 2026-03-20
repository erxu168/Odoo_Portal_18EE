'use client';

import React from 'react';

/**
 * Reusable confirmation dialog - slides up from bottom.
 * UX rule: always show before any confirming/irreversible action.
 *
 * onConfirm: primary action (top button)
 * onCancel: secondary action (bottom button)
 * onDismiss: backdrop tap (defaults to onCancel if not provided)
 */
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss?: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', variant = 'primary', onConfirm, onCancel, onDismiss }: ConfirmDialogProps) {
  const btnColor = variant === 'danger'
    ? 'bg-red-600 text-white active:bg-red-700 shadow-lg shadow-red-600/30'
    : 'bg-orange-500 text-white active:bg-orange-600 shadow-lg shadow-orange-500/30';

  return (
    <div className="fixed inset-0 bg-black/40 z-[110] flex items-end justify-center" onClick={onDismiss || onCancel}>
      <div className="bg-white rounded-t-[20px] w-full max-w-lg p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mb-4" />
        <h3 className="text-[16px] font-bold text-[#1F2933] mb-1">{title}</h3>
        <p className="text-[13px] text-gray-500 leading-relaxed mb-5">{message}</p>
        <button onClick={onConfirm} className={`w-full py-3.5 rounded-xl text-[14px] font-bold mb-2 transition-all active:scale-[0.975] ${btnColor}`}>{confirmLabel}</button>
        <button onClick={onCancel} className="w-full py-3 rounded-xl text-[13px] font-semibold text-gray-500 bg-gray-100 active:bg-gray-200 transition-all">{cancelLabel}</button>
      </div>
    </div>
  );
}
