'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BottomSheet from './BottomSheet';
import NumpadCore, { type NumpadLayout } from './NumpadCore';
import {
  bufferFromValue,
  commit as commitBuffer,
  applyKey,
  keyFromChar,
  validate,
  type NumericRules,
  type NumericValue,
} from '@/lib/numeric-input';

/**
 * NumpadProvider — the single numpad host for the whole portal.
 *
 * Spec: docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 * Mounted once in the root layout. Any field can ask for the pad through
 * `useNumpad().open(...)`; only one is ever open.
 *
 * Four things here exist because of how staff actually use Android tablets, and
 * each would be a daily annoyance if it were missing:
 *
 *  - **KNOWN GAP — Android Back does NOT close the pad.** It was built that way
 *    (a pushed history entry, popped on close) and had to come out: several
 *    modules run their own popstate routers — `app/shifts/page.tsx` translates
 *    ANY popstate into "go to the parent screen" — so the pop on every Confirm
 *    tore the screen out from under the user and threw away the whole edit
 *    sheet. Losing a Back shortcut is a far smaller cost than losing a
 *    manager's work on every single save. Restoring it needs those routers to
 *    agree on a shared, marked history entry; until then Back does whatever the
 *    surrounding module already did.
 *  - **Hardware keys are captured, not left to the page.** inputMode="none" only
 *    suppresses the on-screen keyboard; a Bluetooth keyboard still types into
 *    the focused input underneath, and its Enter submits the surrounding form —
 *    saving before the user pressed Confirm.
 *  - **Barcode scanners are ignored.** They are HID keyboards that fire a digit
 *    burst plus Enter. Un-guarded, one stray scan commits a 13-digit EAN as a
 *    quantity.
 *  - **Commit can be async.** A work-order save round-trips to Odoo; the pad
 *    stays open with a spinner and keeps the value if the save fails, instead of
 *    closing over a failure the user never sees.
 */

/** Keys arriving faster than this are machine-fast, not finger-fast. */
const BURST_GAP_MS = 50;
/** How many consecutive machine-fast keys before we treat it as a scan and discard it. */
const BURST_TRIP = 4;

export interface NumpadQuickAction {
  label: string;
  value: number;
}

export interface NumpadRequest {
  rules: NumericRules;
  /** Value the pad opens on. null/undefined opens blank. */
  initialValue?: NumericValue;
  label?: string;
  sublabel?: string;
  unit?: string;
  confirmLabel?: string;
  layout?: NumpadLayout;
  /** One-tap fills, e.g. "Match (12)" on a work order. */
  quickActions?: NumpadQuickAction[];
  /** Extra content above the keys — e.g. a tolerance range hint. */
  hint?: React.ReactNode;
  /**
   * A rule only the caller can express — Manufacturing's demand ± tolerance, for
   * instance. Return a reason to block Confirm, or null to allow. Runs only
   * after the generic rules pass, so it never has to re-check the basics.
   */
  extraValidate?: (value: NumericValue) => string | null;
  /**
   * Called with the committed value. May return a Promise: the pad shows a
   * spinner until it settles, closes on success, and stays open showing the
   * error on failure.
   */
  onCommit: (value: NumericValue) => void | Promise<void>;
  /** Called when the user backs out. */
  onCancel?: () => void;
}

interface NumpadContextValue {
  open: (request: NumpadRequest) => void;
  close: () => void;
  isOpen: boolean;
}

const NumpadContext = createContext<NumpadContextValue | null>(null);

/**
 * Access the shared pad. Returns null when no provider is mounted, so a
 * component can fall back to a plain input rather than crash.
 */
export function useNumpad(): NumpadContextValue | null {
  return useContext(NumpadContext);
}

export default function NumpadProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<NumpadRequest | null>(null);
  const [buffer, setBuffer] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mirrors for the document-level key handler, which is registered once and
  // must not be re-bound on every keystroke.
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;
  const requestRef = useRef(request);
  requestRef.current = request;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  /** The element to return focus to when the pad closes. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const burstRef = useRef<{
    last: number;
    count: number;
    burstStart: string | null;
    tripped: boolean;
    /** Buffer as it stood before the key applied one step ago — the rewind target. */
    beforeLastKey: string;
  }>({
    last: 0,
    count: 0,
    burstStart: null,
    tripped: false,
    beforeLastKey: '',
  });

  useEffect(() => setMounted(true), []);

  /** Close without touching history — used when history itself is what closed us. */
  const closeInternal = useCallback(() => {
    setRequest(null);
    setBuffer('');
    setSaving(false);
    setError(null);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // Give React the frame to unmount the pad before the field takes focus back.
    if (target && document.contains(target)) {
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }, []);

  const close = useCallback(() => {
    closeInternal();
  }, [closeInternal]);

  const cancel = useCallback(() => {
    requestRef.current?.onCancel?.();
    close();
  }, [close]);

  const open = useCallback((next: NumpadRequest) => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    // Take focus off the field so the OS keyboard (if one slipped through) drops
    // and hardware keys have nowhere else to land.
    if (active instanceof HTMLElement) active.blur();

    setRequest(next);
    setBuffer(bufferFromValue(next.initialValue, next.rules));
    setError(null);
    setSaving(false);
    burstRef.current = { last: 0, count: 0, burstStart: null, tripped: false, beforeLastKey: '' };
  }, []);

  const doCommit = useCallback(async () => {
    const req = requestRef.current;
    if (!req || savingRef.current) return;
    const value = commitBuffer(bufferRef.current, req.rules);
    if (value === undefined) return; // Not committable — Confirm is disabled anyway.
    // A caller rule (tolerance, say) can refuse too. Checked here as well as in
    // the button's disabled state, so hardware Enter cannot slip past it.
    if (req.extraValidate && req.extraValidate(value)) return;

    let result: void | Promise<void>;
    try {
      result = req.onCommit(value);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
      return;
    }

    if (result && typeof (result as Promise<void>).then === 'function') {
      setSaving(true);
      setError(null);
      try {
        await result;
        setSaving(false);
        close();
      } catch (err: unknown) {
        // Stay open and keep the typed value — the user must see the failure.
        setSaving(false);
        setError(err instanceof Error ? err.message : 'Could not save');
      }
      return;
    }
    close();
  }, [close]);

  // Hardware keys. Capture phase so nothing reaches the page: an underlying
  // input must not receive the digits, and Enter must not submit its form.
  useEffect(() => {
    if (!request) return;
    const rules = request.rules;

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (savingRef.current) {
        // Mid-save the pad accepts nothing but must still swallow Enter, or a
        // second Enter would reach the form behind it.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }
        return;
      }

      const isPadKey =
        e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' || keyFromChar(e.key) !== null;
      if (!isPadKey) return;

      // Barcode-scanner burst: discard the whole scan and swallow the rest,
      // including the scanner's trailing Enter.
      //
      // The rewind target is the buffer from BEFORE the key applied one step
      // ago, not the buffer at the first machine-fast key. A scan's opening
      // digit arrives after an idle pause and is therefore indistinguishable
      // from a human keystroke by timing alone — it gets applied, and only the
      // NEXT key reveals a burst. Anchoring on the first fast key would leave
      // that opening digit behind, turning a typed 12 into 124 and calling it a
      // quantity. Stepping one further back costs at most one genuine keystroke
      // in the rare case a scan lands within 50ms of the user's own typing —
      // and a visibly missing digit is far safer than a silently wrong one.
      const now = performance.now();
      const gap = now - burstRef.current.last;
      burstRef.current.last = now;
      if (gap >= BURST_GAP_MS) {
        burstRef.current.count = 0;
        burstRef.current.tripped = false;
        burstRef.current.burstStart = null;
      } else {
        burstRef.current.count += 1;
        if (burstRef.current.count === 1) burstRef.current.burstStart = burstRef.current.beforeLastKey;
        if (burstRef.current.count >= BURST_TRIP) burstRef.current.tripped = true;
      }
      if (burstRef.current.tripped) {
        e.preventDefault();
        e.stopPropagation();
        const rewind = burstRef.current.burstStart;
        if (rewind !== null) setBuffer(rewind);
        return;
      }
      burstRef.current.beforeLastKey = bufferRef.current;

      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Enter') {
        // Ignored while the value is not committable, so Enter can never bypass
        // a range rule that has Confirm disabled.
        if (validate(bufferRef.current, rules).canCommit) void doCommit();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setBuffer((b) => applyKey(b, 'del', rules));
        return;
      }
      const key = keyFromChar(e.key);
      if (key) setBuffer((b) => applyKey(b, key, rules));
    }

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [request, doCommit]);

  // Move focus into the pad so assistive tech follows it and stray keys have a home.
  useEffect(() => {
    if (request && panelRef.current) panelRef.current.focus({ preventScroll: true });
  }, [request]);

  const ctx: NumpadContextValue = { open, close: cancel, isOpen: request !== null };

  const validity = request ? validate(buffer, request.rules) : null;
  const committable = request && validity?.canCommit ? commitBuffer(buffer, request.rules) : undefined;
  const extraReason =
    request?.extraValidate && validity?.canCommit && committable !== undefined
      ? request.extraValidate(committable)
      : null;
  const canCommit = !!validity?.canCommit && !extraReason && !saving;

  return (
    <NumpadContext.Provider value={ctx}>
      {children}
      {mounted && request && createPortal(
        // Portalled to <body> and above every app sheet: the pad is usually
        // opened from a field INSIDE one, and rendered in place it would paint
        // behind the very sheet that opened it. z-150 clears the highest sheet
        // in the codebase (baseZ={140}, ProductSettings/TemplateForm) and still
        // sits under the shared-device PIN gate at z-200.
        <div className="relative z-[150]">
          <BottomSheet
            title={request.label || 'Enter a number'}
            onClose={cancel}
            closeLabel="Cancel"
            footer={
              <button
                type="button"
                onClick={() => void doCommit()}
                disabled={!canCommit}
                className="w-full py-4 rounded-2xl text-[15px] font-bold shadow-lg active:scale-[0.975] transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 text-white shadow-green-600/30 active:bg-green-700"
              >
                {saving ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto block" />
                ) : (
                  request.confirmLabel || 'Confirm'
                )}
              </button>
            }
          >
            <div ref={panelRef} tabIndex={-1} className="outline-none">
              {request.sublabel && <div className="text-[12px] text-gray-400 mb-1 px-1">{request.sublabel}</div>}

              <NumpadCore
                buffer={buffer}
                onBufferChange={setBuffer}
                rules={request.rules}
                layout={request.layout}
                unit={request.unit}
              >
                {request.hint}
                {request.quickActions && request.quickActions.length > 0 && (
                  <div className="flex gap-2 mb-3">
                    {request.quickActions.map((qa) => (
                      <button
                        type="button"
                        key={qa.label}
                        onClick={() => setBuffer(String(qa.value))}
                        className="flex-1 h-10 rounded-xl bg-green-50 border border-green-200 text-green-800 text-[13px] font-bold active:scale-95 transition-transform"
                      >
                        {qa.label}
                      </button>
                    ))}
                  </div>
                )}
              </NumpadCore>

              {extraReason && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold">
                  {extraReason}
                </div>
              )}

              {error && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold">
                  {error}
                </div>
              )}
            </div>
          </BottomSheet>
        </div>,
        document.body,
      )}
    </NumpadContext.Provider>
  );
}
