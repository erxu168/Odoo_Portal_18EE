'use client';

import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({ message, type = 'info', visible, onDismiss, duration = 3500 }: ToastProps) {
  useEffect(() => {
    if (visible && duration > 0) {
      const t = setTimeout(onDismiss, duration);
      return () => clearTimeout(t);
    }
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  const bg = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-gray-800';
  const icon = type === 'success' ? '\u2713' : type === 'error' ? '\u2717' : '\u24d8';

  return (
    <div className="fixed top-14 left-4 right-4 z-[90] animate-[slideDown_0.25s_ease-out]">
      <div className={`${bg} rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl`}>
        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <span className="text-[14px] text-white font-bold">{icon}</span>
        </div>
        <div className="flex-1 text-[14px] text-white font-medium leading-snug">{message}</div>
        <button onClick={onDismiss} className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 active:bg-white/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
  );
}
