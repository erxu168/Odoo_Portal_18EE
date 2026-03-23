'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Krawings Debug Overlay v3
 * - Screen tab: route, screen ID, component, context
 * - Element tab: LIVE inspector + DOM tree walk (▲ Parent / ▼ Child)
 * - Tap to pin, then use ▲/▼ to navigate to containers
 * Activate: ?debug=1 in URL. Persists in localStorage.
 */

interface DebugInfo {
  screen?: string; module?: string; component?: string;
  recipeId?: number; recipeName?: string; mode?: string;
  batch?: number; stepCount?: number; extra?: Record<string, unknown>;
}

interface ElInfo {
  tag: string; id: string; classes: string[]; text: string;
  role: string; dbg: string; ariaLabel: string;
  rect: { x: number; y: number; w: number; h: number };
  ancestors: string[]; inputType: string; href: string;
  tailwind: string[]; interactable: boolean;
  childCount: number; depth: number;
}

let _debugInfo: DebugInfo = {};
let _listeners: Array<() => void> = [];
export function setDebugInfo(info: Partial<DebugInfo>) { _debugInfo = { ..._debugInfo, ...info }; _listeners.forEach(fn => fn()); }
export function clearDebugInfo() { _debugInfo = {}; _listeners.forEach(fn => fn()); }

function useDebugInfo(): DebugInfo {
  const [, setTick] = useState(0);
  useEffect(() => { const fn = () => setTick(t => t + 1); _listeners.push(fn); return () => { _listeners = _listeners.filter(l => l !== fn); }; }, []);
  return _debugInfo;
}

const TW_PFX = ['bg-','text-','px-','py-','p-','mx-','my-','m-','w-','h-','min-','max-','flex','grid','gap-','rounded','border','shadow','font-','leading-','tracking-','z-','fixed','absolute','relative','sticky','overflow','opacity','transition','animate-','items-','justify-','self-'];
function isTw(c: string) { return TW_PFX.some(p => c.startsWith(p)); }
function isDbg(el: EventTarget | null): boolean { return !!el && el instanceof HTMLElement && !!el.closest('[data-debug-overlay]'); }

function getElInfo(el: HTMLElement, depth?: number): ElInfo {
  const rect = el.getBoundingClientRect();
  const all = Array.from(el.classList);
  const tw = all.filter(isTw).slice(0, 12);
  const other = all.filter(c => !isTw(c) && c.length < 50).slice(0, 4);
  const own = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => (n.textContent || '').trim()).join(' ').substring(0, 60);
  const text = own || (el.textContent || '').trim().substring(0, 60);
  const anc: string[] = [];
  let node: HTMLElement | null = el.parentElement;
  let dbg = el.getAttribute('data-dbg') || '';
  let d = depth ?? 0;
  if (depth === undefined) { let p = el.parentElement; while (p) { d++; p = p.parentElement; } }
  while (node && anc.length < 4) {
    const t = node.tagName.toLowerCase();
    const nid = node.id ? `#${node.id}` : '';
    const nc = node.className && typeof node.className === 'string' ? node.className.split(' ').filter(c => c && !isTw(c) && c.length < 25).slice(0, 1).map(c => '.' + c).join('') : '';
    anc.push(`${t}${nid}${nc}`);
    if (!dbg && node.getAttribute('data-dbg')) dbg = node.getAttribute('data-dbg') || '';
    node = node.parentElement;
  }
  return {
    tag: el.tagName.toLowerCase(), id: el.id || '', classes: other,
    text: text.length > 55 ? text.substring(0, 55) + '\u2026' : text,
    role: el.getAttribute('role') || '', dbg,
    ariaLabel: el.getAttribute('aria-label') || '',
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    ancestors: anc,
    inputType: el instanceof HTMLInputElement ? el.type : el instanceof HTMLTextAreaElement ? 'textarea' : el instanceof HTMLSelectElement ? 'select' : '',
    href: el instanceof HTMLAnchorElement ? el.href : '',
    tailwind: tw, childCount: el.children.length, depth: d,
    interactable: ['BUTTON','A','INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.getAttribute('role') === 'button' || !!el.onclick,
  };
}

function descEl(i: ElInfo): string {
  if (i.dbg) return i.dbg;
  const t = i.text.substring(0, 25);
  if (i.tag === 'button') return `Button${t ? ': "' + t + '"' : ''}`;
  if (i.tag === 'input') return `Input[${i.inputType}]`;
  if (i.tag === 'textarea') return 'Textarea';
  if (i.tag === 'select') return 'Select';
  if (i.tag === 'a') return `Link${t ? ': "' + t + '"' : ''}`;
  if (i.tag === 'img') return 'Image';
  if (i.tag === 'svg' || i.tag === 'path' || i.tag === 'circle') return 'SVG';
  if (['h1','h2','h3','h4'].includes(i.tag)) return `${i.tag.toUpperCase()}${t ? ': "' + t + '"' : ''}`;
  if ((i.tag === 'p' || i.tag === 'span') && t) return `${i.tag}: "${t}"`;
  if (i.tag === 'div' && t) return `div: "${t}"`;
  return `<${i.tag}>${i.id ? ' #' + i.id : ''}`;
}

export default function DebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [hovered, setHovered] = useState<ElInfo | null>(null);
  const [pinned, setPinned] = useState<ElInfo | null>(null);
  const [route, setRoute] = useState('');
  const [userInfo, setUserInfo] = useState<{ name: string; role: string; id: number } | null>(null);
  const [tab, setTab] = useState<'screen' | 'element'>('screen');
  const hlRef = useRef<HTMLDivElement>(null);
  const lbRef = useRef<HTMLDivElement>(null);
  const lastElRef = useRef<Element | null>(null);
  const pinnedElRef = useRef<HTMLElement | null>(null);
  const inspRef = useRef(false);
  const info = useDebugInfo();
  inspRef.current = inspectMode;

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const u = p.get('debug') === '1'; const l = localStorage.getItem('kw_debug') === '1';
    if (u) localStorage.setItem('kw_debug', '1');
    setEnabled(u || l); setRoute(window.location.pathname);
  }, []);

  useEffect(() => {
    const o = new MutationObserver(() => setRoute(window.location.pathname));
    o.observe(document.querySelector('body')!, { childList: true, subtree: true });
    return () => o.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUserInfo({ name: d.user.name, role: d.user.role, id: d.user.id }); }).catch(() => {});
  }, [enabled]);

  const posHL = useCallback((ei: ElInfo) => {
    if (!hlRef.current || !lbRef.current) return;
    const r = ei.rect;
    hlRef.current.style.cssText = `display:block;position:fixed;z-index:9997;pointer-events:none;border:2px solid ${pinned ? '#ff4444' : '#e91e9e'};background:${pinned ? 'rgba(255,68,68,0.06)' : 'rgba(233,30,158,0.06)'};border-radius:3px;transition:all 0.08s;left:${r.x-2}px;top:${r.y-2}px;width:${r.w+4}px;height:${r.h+4}px`;
    lbRef.current.style.cssText = `display:block;position:fixed;z-index:9997;pointer-events:none;background:${pinned ? '#ff4444' : '#e91e9e'};color:white;font-size:10px;font-weight:700;font-family:monospace;padding:1px 6px;border-radius:3px;white-space:nowrap;left:${Math.max(4,r.x)}px;top:${r.y > 28 ? r.y - 24 : r.y + r.h + 4}px`;
    lbRef.current.textContent = `${ei.tag}${ei.id ? '#'+ei.id : ''} ${r.w}\u00d7${r.h} [depth ${ei.depth}]`;
  }, [pinned]);

  const hideHL = useCallback(() => {
    if (hlRef.current) hlRef.current.style.display = 'none';
    if (lbRef.current) lbRef.current.style.display = 'none';
  }, []);

  // Select an element (for tree walking)
  const selectEl = useCallback((el: HTMLElement) => {
    pinnedElRef.current = el;
    const ei = getElInfo(el);
    setPinned(ei); setHovered(ei); posHL(ei);
    setTab('element'); setVisible(true);
  }, [posHL]);

  // Walk to parent
  const walkUp = useCallback(() => {
    const el = pinnedElRef.current;
    if (!el || !el.parentElement || el.parentElement === document.body) return;
    selectEl(el.parentElement);
  }, [selectEl]);

  // Walk to first child
  const walkDown = useCallback(() => {
    const el = pinnedElRef.current;
    if (!el || el.children.length === 0) return;
    selectEl(el.children[0] as HTMLElement);
  }, [selectEl]);

  // Walk to next sibling
  const walkNext = useCallback(() => {
    const el = pinnedElRef.current;
    if (!el) return;
    const next = el.nextElementSibling as HTMLElement | null;
    if (next) selectEl(next);
  }, [selectEl]);

  // Walk to prev sibling
  const walkPrev = useCallback(() => {
    const el = pinnedElRef.current;
    if (!el) return;
    const prev = el.previousElementSibling as HTMLElement | null;
    if (prev) selectEl(prev);
  }, [selectEl]);

  useEffect(() => {
    if (!inspectMode) { hideHL(); lastElRef.current = null; return; }
    function getT(e: MouseEvent | TouchEvent): HTMLElement | null {
      const cx = 'touches' in e ? (e.touches[0]||e.changedTouches[0]).clientX : (e as MouseEvent).clientX;
      const cy = 'touches' in e ? (e.touches[0]||e.changedTouches[0]).clientY : (e as MouseEvent).clientY;
      const el = document.elementFromPoint(cx, cy);
      return el instanceof HTMLElement ? el : null;
    }
    function onMove(e: MouseEvent | TouchEvent) {
      if (!inspRef.current) return;
      const t = getT(e); if (!t || isDbg(t) || t === lastElRef.current) return;
      lastElRef.current = t;
      const ei = getElInfo(t); setHovered(ei); posHL(ei); setTab('element'); setVisible(true);
    }
    function onTM(e: TouchEvent) { if (!inspRef.current) return; if (!isDbg(e.target)) e.preventDefault(); onMove(e); }
    function onClick(e: MouseEvent | TouchEvent) {
      if (!inspRef.current || isDbg(e.target)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const t = getT(e); if (!t || isDbg(t)) return;
      pinnedElRef.current = t;
      const ei = getElInfo(t);
      setPinned(p => (p && p.rect.x === ei.rect.x && p.rect.y === ei.rect.y) ? null : ei);
      setHovered(ei); posHL(ei); setTab('element'); setVisible(true);
    }
    function block(e: Event) { if (inspRef.current && !isDbg(e.target)) { e.preventDefault(); e.stopPropagation(); } }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('touchmove', onTM, { capture: true, passive: false });
    document.addEventListener('touchend', onClick, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('touchstart', block, { capture: true, passive: false });
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('touchmove', onTM, true);
      document.removeEventListener('touchend', onClick, true);
      document.removeEventListener('mousedown', block, true);
      document.removeEventListener('touchstart', block, true);
    };
  }, [inspectMode, posHL, hideHL]);

  if (!enabled) return null;
  const disp = pinned || hovered;
  const sE = [
    ['Route', route], ['Module', info.module || inferMod(route)],
    ['Screen', info.screen || '\u2014'], ['Component', info.component || '\u2014'],
    ['Mode', info.mode || '\u2014'],
    ['Recipe', info.recipeName ? `${info.recipeName} (#${info.recipeId})` : '\u2014'],
    ['Batch', info.batch !== undefined ? String(info.batch) : '\u2014'],
    ['Steps', info.stepCount !== undefined ? String(info.stepCount) : '\u2014'],
    ['User', userInfo ? `${userInfo.name} (${userInfo.role}) #${userInfo.id}` : '...'],
  ].filter(([,v]) => v !== '\u2014');

  const eE = disp ? [
    ['What', descEl(disp)],
    ['Tag', `<${disp.tag}>${disp.id ? ' #'+disp.id : ''}${disp.interactable ? ' \u2b50' : ''}`],
    ['Size', `${disp.rect.w}\u00d7${disp.rect.h} at (${disp.rect.x}, ${disp.rect.y})`],
    ['Depth', `${disp.depth} | ${disp.childCount} children`],
    ['Text', disp.text || '\u2014'],
    ['Tailwind', disp.tailwind.length > 0 ? disp.tailwind.join(' ') : '\u2014'],
    ['Classes', disp.classes.length > 0 ? disp.classes.join(' ') : '\u2014'],
    ['data-dbg', disp.dbg || '\u2014'],
    ['Aria', disp.ariaLabel || '\u2014'],
    ['Parents', disp.ancestors.slice(0, 3).join(' \u203a ') || '\u2014'],
  ].filter(([,v]) => v !== '\u2014') : [];

  const entries = tab === 'screen' ? sE : eE;
  const hasPinned = !!pinned && !!pinnedElRef.current;

  return (
    <>
      <div ref={hlRef} style={{ display: 'none' }} />
      <div ref={lbRef} style={{ display: 'none' }} />

      <div data-debug-overlay="true" className="fixed bottom-4 right-4 z-[9999] flex gap-2">
        {inspectMode && (
          <button onClick={() => { setInspectMode(false); setPinned(null); pinnedElRef.current = null; hideHL(); }}
            className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[11px] font-black"
            style={{ background: '#ff4444', color: 'white', border: '2px solid rgba(255,255,255,0.3)' }}>EXIT</button>
        )}
        <button onClick={() => setVisible(!visible)}
          className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-[11px] font-black tracking-wider"
          style={{ background: inspectMode ? '#ff4444' : '#e91e9e', color: 'white', border: '2px solid rgba(255,255,255,0.3)' }}>DEV</button>
      </div>

      {visible && (
        <div data-debug-overlay="true" className="fixed bottom-20 right-2 z-[9998] w-[85vw] max-w-[340px] rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: 'rgba(20,0,30,0.95)', border: '1px solid rgba(233,30,158,0.3)', maxHeight: '55vh' }}>
          {/* Header */}
          <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(233,30,158,0.15)' }}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${inspectMode ? 'bg-red-400' : 'bg-green-400'} animate-pulse`} />
              <span className="text-[11px] font-bold text-white">Debug{inspectMode ? ' \u2014 Inspector' : ''}</span>
              {pinned && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-300 font-bold">PINNED</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => { if (inspectMode) { setInspectMode(false); setPinned(null); pinnedElRef.current = null; hideHL(); } else { setInspectMode(true); setTab('element'); } }}
                className={`px-2 py-0.5 rounded text-[9px] font-bold ${inspectMode ? 'bg-red-500 text-white' : 'bg-white/10 text-white/50'}`}>
                {inspectMode ? 'STOP' : '\ud83d\udd0d Inspect'}</button>
              <button onClick={() => { setInspectMode(false); setPinned(null); pinnedElRef.current = null; hideHL(); localStorage.removeItem('kw_debug'); setEnabled(false); }}
                className="text-[9px] text-white/30 active:text-white/60">OFF</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <button onClick={() => setTab('screen')} className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${tab === 'screen' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-white/25'}`}>Screen</button>
            <button onClick={() => setTab('element')} className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${tab === 'element' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-white/25'}`}>Element {disp ? '\u2022' : ''}</button>
          </div>

          {/* DOM tree nav bar — only when element is pinned */}
          {tab === 'element' && hasPinned && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <span className="text-[9px] text-white/30 font-bold mr-1">NAV</span>
              <button onClick={walkUp} className="px-2 py-1 rounded text-[10px] font-bold text-cyan-300 bg-cyan-400/10 active:bg-cyan-400/20">{'\u25b2'} Parent</button>
              <button onClick={walkDown} disabled={!disp || disp.childCount === 0}
                className={`px-2 py-1 rounded text-[10px] font-bold ${disp && disp.childCount > 0 ? 'text-cyan-300 bg-cyan-400/10 active:bg-cyan-400/20' : 'text-white/15 bg-white/5'}`}>{'\u25bc'} Child</button>
              <button onClick={walkPrev} className="px-2 py-1 rounded text-[10px] font-bold text-cyan-300 bg-cyan-400/10 active:bg-cyan-400/20">{'\u25c0'}</button>
              <button onClick={walkNext} className="px-2 py-1 rounded text-[10px] font-bold text-cyan-300 bg-cyan-400/10 active:bg-cyan-400/20">{'\u25b6'}</button>
            </div>
          )}

          {/* Content */}
          <div className="px-3 py-2 space-y-0.5 overflow-y-auto" style={{ maxHeight: '35vh' }}>
            {tab === 'element' && !disp && (
              <div className="text-center py-4">
                <div className="text-[12px] text-white/25 mb-2">{inspectMode ? 'Tap any element, then use \u25b2\u25bc to walk the tree' : 'Enable inspector to start'}</div>
                {!inspectMode && (
                  <button onClick={() => setInspectMode(true)} className="px-4 py-2 rounded-lg text-[11px] font-bold text-pink-400 bg-pink-400/10 active:bg-pink-400/20">{'\ud83d\udd0d'} Start Inspecting</button>
                )}
              </div>
            )}
            {entries.map(([label, value]) => (
              <div key={label} className="flex items-start gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider min-w-[50px] flex-shrink-0 pt-px" style={{ color: 'rgba(233,30,158,0.6)' }}>{label}</span>
                <span className="text-[10px] font-mono text-white/80 break-all select-all leading-tight">{value}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-3 py-1.5 border-t flex gap-2" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <button onClick={() => window.location.reload()} className="flex-1 py-1 rounded-lg text-[9px] font-bold text-white/50 bg-white/5 active:bg-white/10">Reload</button>
            <button onClick={() => {
              const d = tab === 'screen' ? { route, ...info, user: userInfo } : { element: disp ? descEl(disp) : null, ...disp, screen: info.screen, component: info.component, module: info.module };
              navigator.clipboard.writeText(JSON.stringify(d, null, 2));
            }} className="flex-1 py-1 rounded-lg text-[9px] font-bold text-white/50 bg-white/5 active:bg-white/10">Copy</button>
            {pinned && <button onClick={() => { setPinned(null); pinnedElRef.current = null; }} className="flex-1 py-1 rounded-lg text-[9px] font-bold text-red-400 bg-red-400/10 active:bg-red-400/20">Unpin</button>}
          </div>
        </div>
      )}
    </>
  );
}

function inferMod(r: string): string {
  if (r.startsWith('/recipes')) return 'Chef Guide';
  if (r.startsWith('/manufacturing')) return 'Manufacturing';
  if (r.startsWith('/inventory')) return 'Inventory';
  if (r.startsWith('/purchase')) return 'Purchase';
  if (r.startsWith('/admin')) return 'Admin';
  if (r === '/' || r === '') return 'Dashboard';
  return r;
}
