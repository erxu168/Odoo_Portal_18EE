'use client';

import React, { useEffect, useState } from 'react';

interface InviteInfo {
  valid: boolean;
  name?: string;
  email?: string;
  needs_email?: boolean;
}

export default function InvitePage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/invite/${token}`);
        const data = await res.json();
        setInfo(data);
        if (data.valid && data.email) setEmail(data.email);
      } catch {
        setInfo({ valid: false });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!/\d/.test(password)) { setError('Password must contain at least one number.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      // Logged in via the session cookie set by the server — go to the home screen.
      window.location.href = '/';
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-[24px] font-extrabold text-[#1A1F2E]">KRAWINGS</div>
          <div className="text-[12px] text-gray-400 mt-1 tracking-[0.08em] uppercase">Staff Portal</div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
          </div>
        ) : !info?.valid ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            </div>
            <div className="text-[16px] font-bold text-gray-900 mb-1">This invite link is no longer valid</div>
            <div className="text-[13px] text-gray-500">It may have already been used or expired. Please ask your manager to send you a new one.</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col gap-3">
            <div className="mb-1">
              <div className="text-[18px] font-bold text-gray-900">Welcome{info.name ? `, ${info.name}` : ''}!</div>
              <div className="text-[13px] text-gray-500 mt-0.5">Set up your account to finish.</div>
            </div>

            <label className="text-[12px] font-semibold text-gray-600">Email (your login)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500"
            />

            <label className="text-[12px] font-semibold text-gray-600">Choose a password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters, 1 number"
              autoComplete="new-password"
              className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500"
            />

            <label className="text-[12px] font-semibold text-gray-600">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              autoComplete="new-password"
              className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500"
            />

            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting || !email || !password || !confirm}
              className="h-14 rounded-xl bg-green-600 text-white font-bold text-[14px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all disabled:opacity-50 mt-1 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Create my account'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
