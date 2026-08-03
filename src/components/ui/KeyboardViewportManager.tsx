'use client';

import { useEffect } from 'react';

/**
 * KeyboardViewportManager — keeps the focused text control visible above the
 * Android on-screen keyboard, portal-wide, with no per-screen work.
 *
 * Mounted once in the root layout. Spec:
 * docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 *
 * WHY THIS EXISTS: since Chrome 108 Android shrinks only the VISUAL viewport
 * when the keyboard opens, not the layout viewport. The page keeps its full
 * height, so a field near the bottom — and anything inside a position-fixed
 * sheet — ends up behind the keyboard with nothing scrolling it back.
 *
 * WHAT IT PUBLISHES (consume these instead of writing a second copy of this):
 *   --keyboard-inset-bottom   px height the keyboard covers (0 when closed)
 *   --visual-viewport-height  px height actually visible
 *   html[data-keyboard-open]  present only while the keyboard is up
 *
 * LIMIT — READ BEFORE ASSUMING THIS COVERS YOU: this scrolls. A control inside
 * a `position: fixed` overlay with no scrollable ancestor CANNOT be scrolled
 * (page scroll does not move fixed elements, and the layout viewport no longer
 * shrinks). Such an overlay must consume --keyboard-inset-bottom itself, or
 * wrap its content in an overflow-y-auto container for this to have something
 * to move. Opt a control out entirely with data-keyboard-scroll="off".
 */

/** Below this, a viewport shrink is a browser bar or a split-screen resize, not a keyboard. */
const KEYBOARD_MIN_PX = 150;

/** The focused control must clear the keyboard by this much. Also the occlusion threshold — same number by design, so "should we scroll?" and "is it acceptable?" can never disagree. */
const SAFE_MARGIN_PX = 16;

/** Chrome does its own scroll-into-view first; correct only the residual, once geometry settles. */
const SETTLE_MS = 120;

function isTextControl(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.closest('[data-keyboard-scroll="off"]')) return false;

  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    // inputMode="none" means we are showing our own pad — no OS keyboard, nothing to dodge.
    if (input.inputMode === 'none') return false;
    const nonText = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'];
    return !nonText.includes(input.type);
  }
  return el.isContentEditable;
}

/**
 * Nearest ancestor that can actually scroll. Returns null when the control sits
 * in a fixed overlay with no scroll container — the case documented above.
 */
function nearestScrollable(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    const scrolls = overflowY === 'auto' || overflowY === 'scroll';
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

export default function KeyboardViewportManager() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // No visualViewport (old browsers): leave native behaviour alone.

    const root = document.documentElement;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let keyboardOpen = false;

    /**
     * Keyboard height, derived from GEOMETRY not focus events. Focus alone
     * misfires three ways that all occur on our devices: tablet split-screen
     * resizes (viewport shrinks, no keyboard), a Capacitor WebView set to
     * adjustResize (layout and visual viewport shrink together, delta ~0), and
     * Android's Back dismissing the keyboard while the field keeps focus.
     */
    function keyboardInset(): number {
      if (!vv) return 0;
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      return inset > KEYBOARD_MIN_PX ? Math.round(inset) : 0;
    }

    function publish(inset: number) {
      if (!vv) return;
      root.style.setProperty('--keyboard-inset-bottom', `${inset}px`);
      root.style.setProperty('--visual-viewport-height', `${Math.round(vv.height)}px`);
      const open = inset > 0;
      if (open !== keyboardOpen) {
        keyboardOpen = open;
        if (open) root.setAttribute('data-keyboard-open', '');
        else root.removeAttribute('data-keyboard-open');
      }
    }

    /**
     * Scroll the focused control clear of the keyboard — but only as far as its
     * own top allows, so a tall textarea never has its label pushed off the top.
     */
    function ensureVisible() {
      if (!vv) return;
      const el = document.activeElement;
      if (!isTextControl(el)) return;

      const rect = el.getBoundingClientRect();
      const visibleTop = vv.offsetTop;
      const visibleBottom = vv.offsetTop + vv.height;

      const overflow = rect.bottom - (visibleBottom - SAFE_MARGIN_PX);
      if (overflow <= 0) return; // Already clear — never jump a field that is fine where it is.

      const headroom = rect.top - (visibleTop + SAFE_MARGIN_PX);
      const delta = Math.min(overflow, Math.max(headroom, 0));
      if (delta <= 0) return;

      const scroller = nearestScrollable(el);
      if (scroller) {
        const before = scroller.scrollTop;
        scroller.scrollTop = before + delta;
        const residual = delta - (scroller.scrollTop - before);
        // The inner scroller may already be at its end; the page takes the rest.
        if (residual > 1) window.scrollBy(0, residual);
      } else {
        window.scrollBy(0, delta);
      }
    }

    function update() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const inset = keyboardInset();
        publish(inset);
        if (inset === 0) return;
        // Let the keyboard animation and Chrome's own scroll finish, then correct.
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(ensureVisible, SETTLE_MS);
      });
    }

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);

    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer) clearTimeout(settleTimer);
      root.style.removeProperty('--keyboard-inset-bottom');
      root.style.removeProperty('--visual-viewport-height');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);

  return null;
}
