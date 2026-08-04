'use client';

import { useCallback, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

/**
 * Promise-based wrapper around ConfirmDialog — the drop-in replacement for the
 * browser's `confirm()`.
 *
 * WHY THIS EXISTS. `confirm()` shows a grey OS box stamped with the site's
 * address, which reads to staff like a scam warning, and it freezes the whole
 * tab. But swapping it for a rendered dialog normally means rewriting each flow
 * into "remember what was pending → render a dialog → continue in its callback".
 * Done by hand across a dozen delete paths, that is exactly how a delete ends up
 * firing immediately, or twice.
 *
 * So this keeps the original shape. A call site changes from
 *     if (!confirm('Delete this?')) return;
 * to
 *     if (!await confirm({ title: 'Delete this?', ... })) return;
 * and everything after it — including the early return — is untouched.
 *
 * Render `confirmElement` once anywhere in the component.
 *
 *   const { confirm, confirmElement } = useConfirm();
 *   async function remove() {
 *     if (!await confirm({ title: 'Delete the guide?', message: '…',
 *                          confirmLabel: 'Delete', variant: 'danger' })) return;
 *     await api.delete();
 *   }
 *   return <>…{confirmElement}</>;
 */
export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger' = red button. Use it for anything destructive. */
  variant?: 'primary' | 'danger';
}

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions): Promise<boolean> => {
    // One dialog at a time. A second request while one is open is a double-tap
    // (or a second row's delete), and answering ONE dialog must never resolve
    // TWO callers — that is how a stray second delete would slip through.
    // The extra caller is refused, which is the safe direction.
    if (resolver.current) return Promise.resolve(false);
    setOpts(o);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpts(null);
    resolve?.(ok);
  }, []);

  // If the component unmounts with a dialog open the promise never settles, so
  // the awaiting code simply stops before its action. That is deliberate: it
  // fails CLOSED (nothing is deleted) rather than assuming consent.
  const confirmElement = opts ? (
    <ConfirmDialog
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel}
      cancelLabel={opts.cancelLabel}
      variant={opts.variant}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
      onDismiss={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmElement };
}

export default useConfirm;
