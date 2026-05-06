'use client';

import { useState, useCallback } from 'react';

type ToastKind = 'success' | 'error' | 'info';
export interface ToastState {
  msg: string;
  type: ToastKind;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((msg: string, type: ToastKind = 'success') => setToast({ msg, type }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  return { toast, showToast, dismissToast };
}
