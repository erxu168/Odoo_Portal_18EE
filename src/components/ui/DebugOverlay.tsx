'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Global debug overlay for Krawings Portal.
 * Features:
 * 1. Screen/component tracking panel (magenta DEV button)
 * 2. Element inspector — tap any element to see what it is
 * Activate: add ?debug=1 to URL. Persists in localStorage.
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

interface InspectedElement {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  role: string;
  dbg: string;
  ariaLabel: string;
  rect: { x: number; y: number; w: number; h: number };
  ancestors: string[];
  clickHandler: boolean;
  inputType: string;
  href: string;
}

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

function getElementInfo(el: HTMLElement): InspectedElement {
  const rect = el.getBoundingClientRect();
  const classes = Array.from(el.classList).filter(c => c.length < 60);
  const text = (el.textContent || '').trim().substring(0, 80);

  // Walk up to find data-dbg or meaningful identifiers
  const ancestors: string[] = [];
  let node: HTMLElement | null = el;
  let dbg = '';
  while (node && ancestors.length < 5) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : '';
    const cls = node.className && typeof node.className === 'string'
      ? '.' + node.className.split(' ').filter(c => c && c.length < 30).slice(0, 2).join('.')
      : '';
    ancestors.push(`${tag}${id}${cls}`);
    if (!dbg && node.getAttribute('data-dbg')) {
      dbg = node.getAttribute('data-dbg') || '';
    }
    node = node.parentElement;
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: classes.slice(0, 8),
    text: text.length > 60 ? text.substring(0, 60) + '...' : text,
    role: el.getAttribute('role') || '',
    dbg,
    ariaLabel: el.getAttribute('aria-label') || '',
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    ancestors: ancestors.slice(1),
    clickHandler: !!(el.onclick || el.getAttribute('onclick')),
    inputType: el instanceof HTMLInputElement ? el.type : el instanceof HTMLTextAreaElement ? 'textarea' : el instanceof HTMLSelectElement ? 'select' : '',
    href: el instanceof HTMLAnchorElement ? el.href : '',
  };
}

function describeElement(info: InspectedElement): string {
  if (info.dbg) return info.dbg;
  if (info.tag === 'button') return `Button: "${info.text.substring(0, 30)}"`;
  if (info.tag === 'input') return `Input[${info.inputType}]${info.ariaLabel ? `: ${info.ariaLabel}` : ''}`;
  if (info.tag === 'textarea') return 'Textarea';
  if (info.tag === 'select') return 'Select dropdown';
  if (info.tag === 'a') return `Link: ${info.href.substring(0, 40)}`;
  if (info.tag === 'img') return 'Image';
  if (info.tag === 'svg') return 'SVG icon';
  if (info.tag === 'h1' || info.tag === 'h2' || info.tag === 'h3') return `Heading ${info.tag}: "${info.text.substring(0, 40)}"`;
  if (info.tag === 'p') return `Paragraph: "${info.text.substring(0, 40)}"`;
  if (info.tag === 'span') return `Span: "${info.text.substring(0, 40)}"`;
  if (info.tag === 'div' && info.text.length < 40 && info.text.length > 0) return `Div: "${info.text}"`;
  return `<${info.tag}>${info.id ? '#' + info.id : ''}`;
}

export default function DebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [inspected, setInspected] = useState<InspectedElement | null>(null);
  const [route, setRoute] = useState('');
  const [userInfo, setUserInfo] = useState<{ name: string; role: string; id: number } | null>(null);
  const [tab, setTab] = useState<'screen' | 'element'>('screen');
  const highlightRef = useRef<HTMLDivElement>(null);
  const info = useDebugInfo();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlDebug = params.get('debug') === '1';
    const lsDebug = localStorage.getItem('kw_debug') === '1';
    if (urlDebug) localStorage.setItem('kw_debug', '1');
    setEnabled(urlDebug || lsDebug);
    setRoute(window.location.pathname);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setRoute(window.location.pathname));
    observer.observe(document.querySelector('body')!, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) setUserInfo({ name: d.user.name, role: d.user.role, id: d.user.id });
    }).catch(() => {});
  }, [enabled]);

  // Element inspector
  const handleInspect = useCallback((e: MouseEvent | TouchEvent) => {
    if (!inspectMode) return;
    e.preventDefault();
    e.stopPropagation();

    const target = 'touches' in e
      ? document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)
      : e.target;

    if (!target || !(target instanceof HTMLElement)) return;

    // Ignore clicks on the debug overlay itself
    if (target.closest('[data-debug-overlay]')) return;

    const elInfo = getElementInfo(target);
    setInspected(elInfo);
    setTab('element');
    setVisible(true);

    // Move highlight
    if (highlightRef.current) {
      const r = elInfo.rect;
      highlightRef.current.style.display = 'block';
      highlightRef.current.style.left = `${r.x}px`;
      highlightRef.current.style.top = `${r.y}px`;
      highlightRef.current.style.width = `${r.w}px`;
      highlightRef.current.style.height = `${r.h}px`;
    }
  }, [inspectMode]);

  useEffect(() => {
    if (!inspectMode) {
      if (highlightRef.current) highlightRef.current.style.display = 'none';
      return;
    }
    document.addEventListener('click', handleInspect, true);
    document.addEventListener('touchstart', handleInspect, true);
    return () => {
      document.removeEventListener('click', handleInspect, true);
      document.removeEventListener('touchstart', handleInspect, true);
    };
  }, [inspectMode, handleInspect]);

  if (!enabled) return null;

  const screenEntries = [
    ['Route', route],
    ['Module', info.module || inferModule(route)],
    ['Screen', info.screen || '\u2014'],
    ['Component', info.component || '\u2014'],
    ['Mode', info.mode || '\u2014'],
    ['Recipe', info.recipeName ? `${info.recipeName} (#${info.recipeId})` : '\u2014'],
    ['Batch', info.batch !== undefined ? String(info.batch) : '\u2014'],
    ['Steps', info.stepCount !== undefined ? String(info.stepCount) : '\u2014'],
    ['User', userInfo ? `${userInfo.name} (${userInfo.role}) #${userInfo.id}` : '...'],
  ].filter(([, v]) => v !== '\u2014');

  const elementEntries = inspected ? [
    ['What', describeElement(inspected)],
    ['Tag', `<${inspected.tag}>${inspected.id ? ' #' + inspected.id : ''}`],
    ['Classes', inspected.classes.length > 0 ? inspected.classes.slice(0, 4).join(' ') : '\u2014'],
    ['Size', `${inspected.rect.w}\u00d7${inspected.rect.h}px at (${inspected.rect.x}, ${inspected.rect.y})`],
    ['Text', inspected.text || '\u2014'],
    ['data-dbg', inspected.dbg || '\u2014'],
    ['Role', inspected.role || '\u2014'],
    ['Parents', inspected.ancestors.slice(0, 3).join(' > ') || '\u2014'],
  ].filter(([, v]) => v !== '\u2014') : [];

  const entries = tab === 'screen' ? screenEntries : elementEntries;

  return (
    <>
      {/* Highlight box for inspected element */}
      <div ref={highlightRef} style={{
        display: 'none', position: 'fixed', zIndex: 9997, pointerEvents: 'none',
        border: '2px solid #e91e9e', background: 'rgba(233, 30, 158, 0.08)',
        borderRadius: '4px', transition: 'all 0.15s ease',
      }} />

      {/* Toggle button */}
      <div data-debug-overlay="true" className="fixed bottom-4 right-4 z-[9999] flex gap-2">
        {inspectMode && (
          <button onClick={() => setInspectMode(false)}
            className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[18px]"
            style={{ background: '#ff4444', border: '2px solid rgba(255,255,255,0.3)' }}>
            {'\ud83d\udd0d'}
          </button>
        )}
        <button onClick={() => setVisible(!visible)}
          className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[11px] font-black tracking-wider"
          style={{ background: '#e91e9e', color: 'white', border: '2px solid rgba(255,255,255,0.3)' }}>
          DEV
        </button>
      </div>

      {/* Panel */}
      {visible && (
        <div data-debug-overlay="true"
          className="fixed bottom-20 right-4 z-[9998] w-80 rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: 'rgba(20, 0, 30, 0.95)', border: '1px solid rgba(233, 30, 158, 0.3)', maxHeight: '60vh' }}>
          {/* Header */}
          <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'rgba(233, 30, 158, 0.15)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[12px] font-bold text-white">Krawings Debug</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setInspectMode(!inspectMode); if (!inspectMode) setTab('element'); }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${inspectMode ? 'bg-red-500 text-white' : 'bg-white/10 text-white/50'}`}>
                {inspectMode ? '\ud83d\udd0d ON' : '\ud83d\udd0d'}
              </button>
              <button onClick={() => { localStorage.removeItem('kw_debug'); setEnabled(false); }}
                className="text-[10px] text-white/40 active:text-white/70">OFF</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <button onClick={() => setTab('screen')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${tab === 'screen' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-white/30'}`}>
              Screen
            </button>
            <button onClick={() => setTab('element')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${tab === 'element' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-white/30'}`}>
              Element {inspected ? '\u2022' : ''}
            </button>
          </div>

          {/* Entries */}
          <div className="px-4 py-2 space-y-1 overflow-y-auto" style={{ maxHeight: '40vh' }}>
            {tab === 'element' && !inspected && (
              <div className="text-center py-4">
                <div className="text-[13px] text-white/30 mb-2">{inspectMode ? 'Tap any element' : 'Turn on inspector'}</div>
                {!inspectMode && (
                  <button onClick={() => setInspectMode(true)}
                    className="px-4 py-2 rounded-lg text-[12px] font-bold text-pink-400 bg-pink-400/10 active:bg-pink-400/20">
                    {'\ud83d\udd0d'} Enable Inspector
                  </button>
                )}
              </div>
            )}
            {entries.map(([label, value]) => (
              <div key={label} className="flex items-start gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider min-w-[55px] flex-shrink-0"
                  style={{ color: 'rgba(233, 30, 158, 0.7)' }}>{label}</span>
                <span className="text-[11px] font-mono text-white/80 break-all select-all">{value}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-4 py-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex gap-2">
              <button onClick={() => window.location.reload()}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-white/60 bg-white/5 active:bg-white/10">
                Reload
              </button>
              <button onClick={() => {
                const data = tab === 'screen'
                  ? { route, ...info, user: userInfo }
                  : { ...inspected, screen: info.screen, module: info.module };
                navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                alert('Copied!');
              }}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-white/60 bg-white/5 active:bg-white/10">
                Copy
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
