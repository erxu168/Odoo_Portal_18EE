'use client';

import React, { useState, useEffect } from 'react';

/**
 * Global debug overlay for Krawings Portal.
 * Shows current route, screen state, user role, and component tree.
 * Toggle with the magenta DEV button (bottom-right corner).
 * Only visible when ?debug=1 is in URL or localStorage has kw_debug=1.
 */

interface DebugInfo {
  screen?: string;
  module?: string;
  component?: string;
  recipeId?: number;
  recipeName?: string;
  mode?: string;
  batch?: number;
  stepCount?: number;
  extra?: Record<string, unknown>;
}

// Global debug state — components call setDebugInfo to update
let _debugInfo: DebugInfo = {};
let _listeners: Array<() => void> = [];

export function setDebugInfo(info: Partial<DebugInfo>) {
  _debugInfo = { ..._debugInfo, ...info };
  _listeners.forEach(fn => fn());
}

export function clearDebugInfo() {
  _debugInfo = {};
  _listeners.forEach(fn => fn());
}

function useDebugInfo(): DebugInfo {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick(t => t + 1);
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); };
  }, []);
  return _debugInfo;
}

export default function DebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [route, setRoute] = useState('');
  const [userInfo, setUserInfo] = useState<{ name: string; role: string; id: number } | null>(null);
  const info = useDebugInfo();

  // Check if debug mode is enabled
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlDebug = params.get('debug') === '1';
    const lsDebug = localStorage.getItem('kw_debug') === '1';
    if (urlDebug) localStorage.setItem('kw_debug', '1');
    setEnabled(urlDebug || lsDebug);
    setRoute(window.location.pathname);
  }, []);

  // Track route changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setRoute(window.location.pathname);
    });
    observer.observe(document.querySelector('body')!, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Fetch user info once
  useEffect(() => {
    if (!enabled) return;
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) setUserInfo({ name: d.user.name, role: d.user.role, id: d.user.id });
    }).catch(() => {});
  }, [enabled]);

  if (!enabled) return null;

  const entries = [
    ['Route', route],
    ['Module', info.module || inferModule(route)],
    ['Screen', info.screen || '—'],
    ['Component', info.component || '—'],
    ['Mode', info.mode || '—'],
    ['Recipe', info.recipeName ? `${info.recipeName} (#${info.recipeId})` : '—'],
    ['Batch', info.batch !== undefined ? String(info.batch) : '—'],
    ['Steps', info.stepCount !== undefined ? String(info.stepCount) : '—'],
    ['User', userInfo ? `${userInfo.name} (${userInfo.role}) #${userInfo.id}` : 'loading...'],
    ['Server', 'Staging (89.167.124.0)'],
  ].filter(([, v]) => v !== '\u2014');

  // Extra entries
  if (info.extra) {
    for (const [k, v] of Object.entries(info.extra)) {
      entries.push([k, String(v)]);
    }
  }

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setVisible(!visible)}
        className="fixed bottom-4 right-4 z-[9999] w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[11px] font-black tracking-wider"
        style={{ background: '#e91e9e', color: 'white', border: '2px solid rgba(255,255,255,0.3)' }}
      >
        DEV
      </button>

      {/* Panel */}
      {visible && (
        <div className="fixed bottom-20 right-4 z-[9998] w-72 rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: 'rgba(20, 0, 30, 0.95)', border: '1px solid rgba(233, 30, 158, 0.3)' }}>
          {/* Header */}
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: 'rgba(233, 30, 158, 0.15)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[12px] font-bold text-white">Krawings Debug</span>
            </div>
            <button onClick={() => { localStorage.removeItem('kw_debug'); setEnabled(false); }}
              className="text-[10px] text-white/40 active:text-white/70">OFF</button>
          </div>

          {/* Entries */}
          <div className="px-4 py-2 space-y-1">
            {entries.map(([label, value]) => (
              <div key={label} className="flex items-start gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider min-w-[60px] flex-shrink-0"
                  style={{ color: 'rgba(233, 30, 158, 0.7)' }}>{label}</span>
                <span className="text-[11px] font-mono text-white/80 break-all">{value}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-4 py-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex gap-2">
              <button onClick={() => { window.location.reload(); }}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-white/60 bg-white/5 active:bg-white/10">
                Reload
              </button>
              <button onClick={() => { navigator.clipboard.writeText(JSON.stringify({ route, ...info, user: userInfo }, null, 2)); alert('Copied to clipboard!'); }}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-white/60 bg-white/5 active:bg-white/10">
                Copy Info
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function inferModule(route: string): string {
  if (route.startsWith('/recipes')) return 'Recipe Guide';
  if (route.startsWith('/manufacturing')) return 'Manufacturing';
  if (route.startsWith('/inventory')) return 'Inventory';
  if (route.startsWith('/purchase')) return 'Purchase';
  if (route.startsWith('/admin')) return 'Admin';
  if (route === '/' || route === '') return 'Dashboard';
  return route;
}
