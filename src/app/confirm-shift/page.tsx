'use client';

import React, { useEffect, useState } from 'react';

/**
 * Public shift-confirmation landing page (no login).
 *
 * Opened from the one-tap link in a reminder email. It does NOT confirm on load —
 * confirming is an explicit tap on this page. That guards against email-security
 * scanners / link-preview services (which may fetch AND render JS) recording a
 * false confirmation just by inspecting the URL. Reads ?token= from the URL and
 * POSTs it to /api/shifts/confirm/email only when the staffer taps the button.
 * Immersive: no app nav chrome.
 */

type State =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'ok'; day: string; time: string; roleName: string; employeeName: string }
  | { kind: 'error'; reason: string };

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: 'This link is missing its confirmation code. Please open the button in your email again.',
  invalid_or_expired: 'This confirmation link is no longer valid — it may have expired or the shift has already passed.',
  not_found: 'We couldn’t find that shift. It may have been removed.',
  not_published: 'This shift isn’t active right now, so there’s nothing to confirm. Your manager may have changed it.',
  reassigned: 'This shift is no longer assigned to you, so there’s nothing to confirm.',
  server_error: 'Something went wrong on our side. Please try the link again in a moment.',
};

export default function ConfirmShiftPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'ready' });

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    if (!t) {
      setState({ kind: 'error', reason: 'missing_token' });
      return;
    }
    setToken(t);
  }, []);

  async function confirmNow() {
    if (!token) return;
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/shifts/confirm/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (data.ok) {
        setState({
          kind: 'ok',
          day: String(data.day || ''),
          time: String(data.time || ''),
          roleName: String(data.roleName || ''),
          employeeName: String(data.employeeName || ''),
        });
      } else {
        setState({ kind: 'error', reason: String(data.error || 'server_error') });
      }
    } catch {
      setState({ kind: 'error', reason: 'server_error' });
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="text-[20px] font-extrabold tracking-tight text-[#1A1F2E]">KRAWINGS</div>
        <div className="text-[12px] font-bold text-green-600 tracking-wide mt-1 mb-6">STAFF PORTAL</div>

        {(state.kind === 'ready' || state.kind === 'loading') && (
          <div className="flex flex-col items-center py-2">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h1 className="text-[19px] font-bold text-gray-900">Confirm your shift</h1>
            <p className="text-[14px] text-gray-500 mt-2 leading-snug">
              Tap below to let your manager know you&rsquo;ll be there.
            </p>
            <button
              onClick={confirmNow}
              disabled={state.kind === 'loading'}
              className="mt-6 w-full py-3.5 rounded-xl bg-green-600 text-white text-[15px] font-bold active:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {state.kind === 'loading' ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Confirming…
                </>
              ) : (
                <>I&rsquo;ll be there ✅</>
              )}
            </button>
          </div>
        )}

        {state.kind === 'ok' && (
          <div className="flex flex-col items-center py-2">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-[19px] font-bold text-gray-900">You&rsquo;re confirmed</h1>
            {state.employeeName && (
              <p className="text-[13px] text-gray-500 mt-1">Thanks, {state.employeeName.split(' ')[0]}!</p>
            )}
            <div className="w-full bg-[#F9FAFB] border border-gray-200 rounded-xl px-4 py-4 mt-5">
              <div className="text-[17px] font-extrabold text-gray-900">{state.day}</div>
              <div className="text-[15px] font-semibold text-gray-600 mt-0.5">
                {state.time}
                {state.roleName ? ` · ${state.roleName}` : ''}
              </div>
            </div>
            <p className="text-[13px] text-gray-500 mt-5 leading-snug">
              See you then. Can&rsquo;t make it after all? Let your manager know as soon as you can.
            </p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-center py-2">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="text-[18px] font-bold text-gray-900">Couldn&rsquo;t confirm</h1>
            <p className="text-[14px] text-gray-500 mt-2 leading-snug">
              {ERROR_MESSAGES[state.reason] || ERROR_MESSAGES.server_error}
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-6">Krawings Staff Portal</p>
    </div>
  );
}
