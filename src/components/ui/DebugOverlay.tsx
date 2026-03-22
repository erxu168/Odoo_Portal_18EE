'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Krawings Debug Overlay v2
 * - Screen tab: shows current route, screen ID, component, context
 * - Element tab: LIVE inspector — hover (desktop) or drag finger (mobile)
 *   over any element and the panel + highlight update in real-time.
 *   Tap/click to PIN an element. Tap elsewhere to unpin.
 * Activate: ?debug=1 in URL. Persists in localStorage.
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

interface ElInfo {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  role: string;
  dbg: string;
  ariaLabel: string;
  rect: { x: number; y: number; w: number; h: number };
  ancestors: string[];
  inputType: string;
  href: string;
  tailwind: string[];
  interactable: boolean;
}

// --- Global debug state ---
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

// --- Element analysis ---
const TW_PREFIXES = ['bg-', 'text-', 'px-', 'py-', 'p-', 'mx-', 'my-', 'm-', 'w-', 'h-', 'min-', 'max-', 'flex', 'grid', 'gap-', 'rounded', 'border', 'shadow', 'font-', 'leading-', 'tracking-', 'z-', 'fixed', 'absolute', 'relative', 'sticky', 'overflow', 'opacity', 'transition', 'animate-', 'items-', 'justify-', 'self-'];

function isTailwind(cls: string): boolean {
  return TW_PREFIXES.some(p => cls.startsWith(p));
}

function getElInfo(el: HTMLElement): ElInfo {
  const rect = el.getBoundingClientRect();
  const allClasses = Array.from(el.classList);
  const twClasses = allClasses.filter(isTailwind).slice(0, 12);
  const otherClasses = allClasses.filter(c => !isTailwind(c) && c.length < 50).slice(0, 4);
  const ownText = Array.from(el.childNodes)
    .filter(n => n.nodeType === Node.TEXT_NODE)
    .map(n => (n.textContent || '').trim())
    .join(' ')
    .substring(0, 60);
  const text = ownText || (el.textContent || '').trim().substring(0, 60);

  const ancestors: string[] = [];
  let node: HTMLElement | null = el.parentElement;
  let dbg = el.getAttribute('data-dbg') || '';
  while (node && ancestors.length < 4) {
    const tag = node.tagName.toLowerCase();
    const nid = node.id ? `#${node.id}` : '';
    const ncls = node.className && typeof node.className === 'string'
      ? node.className.split(' ').filter(c => c && !isTailwind(c) && c.length < 25).slice(0, 1).map(c => '.' + c).join('')
      : '';
    ancestors.push(`${tag}${nid}${ncls}`);
    if (!dbg && node.getAttribute('data-dbg')) dbg = node.getAttribute('data-dbg') || '';
    node = node.parentElement;
  }

  const isInteractable = el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT'
    || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || el.getAttribute('role') === 'button' || el.getAttribute('tabindex') !== null
    || !!el.onclick;

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: otherClasses,
    text: text.length > 55 ? text.substring(0, 55) + '\u2026' : text,
    role: el.getAttribute('role') || '',
    dbg,
    ariaLabel: el.getAttribute('aria-label') || '',
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    ancestors,
    inputType: el instanceof HTMLInputElement ? el.type : el instanceof HTMLTextAreaElement ? 'textarea' : el instanceof HTMLSelectElement ? 'select' : '',
    href: el instanceof HTMLAnchorElement ? el.href : '',
    tailwind: twClasses,
    interactable: isInteractable,
  };
}

function describeEl(info: ElInfo): string {
  if (info.dbg) return info.dbg;
  const t = info.text.substring(0, 25);
  if (info.tag === 'button') return `Button${t ? ': "' + t + '"' : ''}`;
  if (info.tag === 'input') return `Input[${info.inputType}]${info.ariaLabel ? ' ' + info.ariaLabel : ''}`;
  if (info.tag === 'textarea') return 'Textarea';
  if (info.tag === 'select') return 'Select';
  if (info.tag === 'a') return `Link${t ? ': "' + t + '"' : ''}`;
  if (info.tag === 'img') return `Image${info.ariaLabel ? ': ' + info.ariaLabel : ''}`;
  if (info.tag === 'svg' || info.tag === 'path' || info.tag === 'circle') return 'SVG';
  if (['h1', 'h2', 'h3', 'h4'].includes(info.tag)) return `${info.tag.toUpperCase()}${t ? ': "' + t + '"' : ''}`;
  if (info.tag === 'p' || info.tag === 'span' || info.tag === 'label') return `${info.tag}${t ? ': "' + t + '"' : ''}`;
  if (info.tag === 'div' && t) return `div: "${t}"`;
  return `<${info.tag}>${info.id ? ' #' + info.id : ''}`;
}

// --- Component ---
export default function DebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [hovered, setHovered] = useState<ElInfo | null>(null);
  const [pinned, setPinned] = useState<ElInfo | null>(null);
  const [route, setRoute] = useState('');
  const [userInfo, setUserInfo] = useState<{ name: string; role: string; id: number } | null>(null);
  const [tab, setTab] = useState<'screen' | 'element'>('screen');
  const highlightRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const lastElRef = useRef<Element | null>(null);
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
    const obs = new MutationObserver(() => setRoute(window.location.pathname));
    obs.observe(document.querySelector('body')!, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) setUserInfo({ name: d.user.name, role: d.user.role, id: d.user.id });
    }).catch(() => {});
  }, [enabled]);

  // Position highlight + floating label
  const positionHighlight = useCallback((elInfo: ElInfo) => {
    if (!highlightRef.current || !labelRef.current) return;
    const r = elInfo.rect;
    const hl = highlightRef.current;
    const lb = labelRef.current;
    hl.style.display = 'block';
    hl.style.left = `${r.x - 2}px`;
    hl.style.top = `${r.y - 2}px`;
    hl.style.width = `${r.w + 4}px`;
    hl.style.height = `${r.h + 4}px`;
    // Label above or below element
    const labelText = `${elInfo.tag}${elInfo.id ? '#' + elInfo.id : ''} ${r.w}\u00d7${r.h}`;
    lb.textContent = labelText;
    lb.style.display = 'block';
    lb.style.left = `${Math.max(4, r.x)}px`;
    if (r.y > 28) {
      lb.style.top = `${r.y - 24}px`;
    } else {
      lb.style.top = `${r.y + r.h + 4}px`;
    }
  }, []);

  const hideHighlight = useCallback(() => {
    if (highlightRef.current) highlightRef.current.style.display = 'none';
    if (labelRef.current) labelRef.current.style.display = 'none';
  }, []);

  // LIVE hover tracking (mousemove + touchmove)
  const handleMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!inspectMode) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
    const target = document.elementFromPoint(clientX, clientY);

    if (!target || !(target instanceof HTMLElement)) return;
    if (target.closest('[data-debug-overlay]')) return;

    // Skip if same element as last time (perf)
    if (target === lastElRef.current) return;
    lastElRef.current = target;

    const elInfo = getElInfo(target);
    setHovered(elInfo);
    positionHighlight(elInfo);

    // Auto-show panel on element tab if not pinned
    if (!pinned) {
      setTab('element');
      setVisible(true);
    }
  }, [inspectMode, pinned, positionHighlight]);

  // Tap/click to PIN element
  const handleClick = useCallback((e: MouseEvent | TouchEvent) => {
    if (!inspectMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const clientX = 'touches' in e ? e.changedTouches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.changedTouches[0].clientY : (e as MouseEvent).clientY;
    const target = document.elementFromPoint(clientX, clientY);

    if (!target || !(target instanceof HTMLElement)) return;
    if (target.closest('[data-debug-overlay]')) return;

    const elInfo = getElInfo(target);
    setPinned(prev => {
      // If already pinned to this element, unpin
      if (prev && prev.rect.x === elInfo.rect.x && prev.rect.y === elInfo.rect.y) return null;
      return elInfo;
    });
    setHovered(elInfo);
    positionHighlight(elInfo);
    setTab('element');
    setVisible(true);
  }, [inspectMode, positionHighlight]);

  // Prevent touchmove from scrolling in inspect mode
  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!inspectMode) return;
    e.preventDefault();
    handleMove(e);
  }, [inspectMode, handleMove]);

  // Attach/detach listeners
  useEffect(() => {
    if (!inspectMode) {
      hideHighlight();
      lastElRef.current = null;
      return;
    }
    // Desktop: mousemove for live hover, click to pin
    document.addEventListener('mousemove', handleMove, true);
    document.addEventListener('click', handleClick, true);
    // Mobile: touchmove for live tracking, touchend to pin
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', handleClick, true);
    // Block normal interactions while inspecting
    const blockDefault = (e: Event) => { if (inspectMode) { e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('mousedown', blockDefault, true);
    document.addEventListener('touchstart', blockDefault, { capture: true, passive: false });

    return () => {
      document.removeEventListener('mousemove', handleMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleClick, true);
      document.removeEventListener('mousedown', blockDefault, true);
      document.removeEventListener('touchstart', blockDefault, true);
    };
  }, [inspectMode, handleMove, handleClick, handleTouchMove, hideHighlight]);

  if (!enabled) return null;

  const displayed = pinned || hovered;

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

  const elementEntries = displayed ? [
    ['What', describeEl(displayed)],
    ['Tag', `<${displayed.tag}>${displayed.id ? ' #' + displayed.id : ''}${displayed.interactable ? ' \u2b50' : ''}`],
    ['Size', `${displayed.rect.w}\u00d7${displayed.rect.h} at (${displayed.rect.x}, ${displayed.rect.y})`],
    ['Text', displayed.text || '\u2014'],
    ['Tailwind', displayed.tailwind.length > 0 ? displayed.tailwind.join(' ') : '\u2014'],
    ['Classes', displayed.classes.length > 0 ? displayed.classes.join(' ') : '\u2014'],
    ['data-dbg', displayed.dbg || '\u2014'],
    ['Aria', displayed.ariaLabel || '\u2014'],
    ['Parents', displayed.ancestors.slice(0, 3).join(' \u203a ') || '\u2014'],
  ].filter(([, v]) => v !== '\u2014') : [];

  const entries = tab === 'screen' ? screenEntries : elementEntries;

  return (
    <>
      {/* Highlight outline around hovered/pinned element */}
      <div ref={highlightRef} style={{
        display: 'none', position: 'fixed', zIndex: 9997, pointerEvents: 'none',
        border: `2px solid ${pinned ? '#ff4444' : '#e91e9e'}`,
        background: pinned ? 'rgba(255, 68, 68, 0.06)' : 'rgba(233, 30, 158, 0.06)',
        borderRadius: '3px', transition: 'left 0.08s, top 0.08s, width 0.08s, height 0.08s',
      }} />

      {/* Floating tag label near hovered element */}
      <div ref={labelRef} style={{
        display: 'none', position: 'fixed', zIndex: 9997, pointerEvents: 'none',
        background: pinned ? '#ff4444' : '#e91e9e', color: 'white',
        fontSize: '10px', fontWeight: 700, fontFamily: 'monospace',
        padding: '1px 6px', borderRadius: '3px', whiteSpace: 'nowrap',
      }} />

      {/* Buttons */}
      <div data-debug-overlay="true" className="fixed bottom-4 right-4 z-[9999] flex gap-2">
        {inspectMode && (
          <button onClick={() => { setInspectMode(false); setPinned(null); hideHighlight(); }}
            className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[11px] font-black"
            style={{ background: '#ff4444', color: 'white', border: '2px solid rgba(255,255,255,0.3)' }}>
            EXIT
          </button>
        )}
        <button onClick={() => setVisible(!visible)}
          className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[11px] font-black tracking-wider"
          style={{ background: inspectMode ? '#ff4444' : '#e91e9e', color: 'white', border: '2px solid rgba(255,255,255,0.3)' }}>
          DEV
        </button>
      </div>

      {/* Panel */}
      {visible && (
        <div data-debug-overlay="true"
          className="fixed bottom-20 right-2 z-[9998] w-[85vw] max-w-[340px] rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: 'rgba(20, 0, 30, 0.95)', border: '1px solid rgba(233, 30, 158, 0.3)', maxHeight: '55vh' }}>
          {/* Header */}
          <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(233, 30, 158, 0.15)' }}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${inspectMode ? 'bg-red-400' : 'bg-green-400'} animate-pulse`} />
              <span className="text-[11px] font-bold text-white">Debug{inspectMode ? ' \u2014 Inspector ON' : ''}</span>
              {pinned && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-300 font-bold">PINNED</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => {
                if (inspectMode) { setInspectMode(false); setPinned(null); hideHighlight(); }
                else { setInspectMode(true); setTab('element'); }
              }}
                className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${inspectMode ? 'bg-red-500 text-white' : 'bg-white/10 text-white/50'}`}>
                {inspectMode ? 'STOP' : '\ud83d\udd0d Inspect'}
              </button>
              <button onClick={() => { localStorage.removeItem('kw_debug'); setEnabled(false); setInspectMode(false); }}
                className="text-[9px] text-white/30 active:text-white/60">OFF</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <button onClick={() => setTab('screen')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${tab === 'screen' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-white/25'}`}>
              Screen
            </button>
            <button onClick={() => setTab('element')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${tab === 'element' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-white/25'}`}>
              Element {displayed ? '\u2022' : ''}
            </button>
          </div>

          {/* Content */}
          <div className="px-3 py-2 space-y-0.5 overflow-y-auto" style={{ maxHeight: '38vh' }}>
            {tab === 'element' && !displayed && (
              <div className="text-center py-4">
                <div className="text-[12px] text-white/25 mb-2">
                  {inspectMode ? 'Move finger/cursor over elements' : 'Enable inspector to start'}
                </div>
                {!inspectMode && (
                  <button onClick={() => { setInspectMode(true); }}
                    className="px-4 py-2 rounded-lg text-[11px] font-bold text-pink-400 bg-pink-400/10 active:bg-pink-400/20">
                    {'\ud83d\udd0d'} Start Inspecting
                  </button>
                )}
              </div>
            )}
            {entries.map(([label, value]) => (
              <div key={label} className="flex items-start gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider min-w-[50px] flex-shrink-0 pt-px"
                  style={{ color: 'rgba(233, 30, 158, 0.6)' }}>{label}</span>
                <span className="text-[10px] font-mono text-white/80 break-all select-all leading-tight">{value}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-3 py-1.5 border-t flex gap-2" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <button onClick={() => window.location.reload()}
              className="flex-1 py-1 rounded-lg text-[9px] font-bold text-white/50 bg-white/5 active:bg-white/10">Reload</button>
            <button onClick={() => {
              const data = tab === 'screen'
                ? { route, ...info, user: userInfo }
                : { element: displayed ? describeEl(displayed) : null, ...displayed, screen: info.screen, component: info.component, module: info.module };
              navigator.clipboard.writeText(JSON.stringify(data, null, 2));
            }}
              className="flex-1 py-1 rounded-lg text-[9px] font-bold text-white/50 bg-white/5 active:bg-white/10">Copy</button>
            {pinned && (
              <button onClick={() => { setPinned(null); }}
                className="flex-1 py-1 rounded-lg text-[9px] font-bold text-red-400 bg-red-400/10 active:bg-red-400/20">Unpin</button>
            )}
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
