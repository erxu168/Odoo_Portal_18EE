'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Login failed. Check your email and password.');
        return;
      }

      // Redirect to original page or dashboard
      const next = searchParams.get('next') || '/';
      router.push(next);
      router.refresh();
    } catch {
      setError('Could not connect. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1A1F2E] px-6 pt-20 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 right-1/4 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.2)_0%,transparent_70%)]" />
        <div className="relative">
          <div className="text-[28px] font-bold text-white tracking-tight">KRAWINGS</div>
          <div className="text-[13px] text-white/40 mt-1 tracking-wider">SSAM KOREAN BBQ</div>
          <div className="text-[13px] text-white/30 mt-3">Staff Portal</div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 px-6 py-8">
        <h2 className="text-[20px] font-bold text-gray-900 mb-1">Welcome back</h2>
        <p className="text-[13px] text-gray-500 mb-6">Sign in with your staff account</p>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !email || !password}
            className="w-full h-14 rounded-xl bg-orange-500 text-white font-bold text-[16px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-all disabled:opacity-50 disabled:shadow-none mt-2 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Sign in'
            )}
          </button>
        </div>

        <p className="text-center text-[12px] text-gray-400 mt-8">
          Forgot your password? Ask your manager to reset it.
        </p>
      </div>
    </div>
  );
}
