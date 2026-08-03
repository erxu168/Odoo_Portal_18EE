'use client';

import { useEffect } from 'react';
import { scrollNeededFor } from '@/lib/keyboard-visibility';

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

/**
 * When to correct, after the keyboard starts opening. Chrome does its own
 * scroll-into-view first, and a sheet that subtracts the keyboard from its
 * height re-lays-out during the animation — so one early pass is not enough.
 */
const SETTLE_PASSES_MS = [120, 320, 550];

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

/**
 * Nearest `position: fixed` ancestor — the overlay the control lives in, if any.
 * Skips overlays that declare `data-keyboard-managed`, meaning they already
 * subtract the keyboard themselves and must not be shifted twice.
 */
function nearestFixedOverlay(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (getComputedStyle(node).position === 'fixed') {
      return node.hasAttribute('data-keyboard-managed') ? null : node;
    }
    node = node.parentElement;
  }
  return null;
}

export default function KeyboardViewportManager() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // No visualViewport (old browsers): leave native behaviour alone.

    const root = document.documentElement;
    let settleTimers: ReturnType<typeof setTimeout>[] = [];
    let rafId: number | null = null;
    let keyboardOpen = false;

    function clearSettleTimers() {
      for (const t of settleTimers) clearTimeout(t);
      settleTimers = [];
    }

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
      if (inset <= KEYBOARD_MIN_PX) return 0;

      // Geometry alone is not enough to call it a keyboard: pinch-zoom and
      // accessibility zoom shrink the visual viewport too, and treating that as
      // a keyboard would hide the tab bar and squash every open sheet while the
      // user was only zooming in to read something.
      //
      // So a keyboard must have STARTED with a text control focused. Once it is
      // up it stays up on geometry alone, because tapping a button inside a form
      // moves focus off the field without dismissing the keyboard.
      if (!keyboardOpen && !isTextControl(document.activeElement)) return 0;

      return Math.round(inset);
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
     * A fixed overlay cannot be scrolled — page scroll does not move fixed
     * elements, and the layout viewport no longer shrinks — so the only way to
     * lift its content clear of the keyboard is to reserve the space inside it.
     *
     * Doing it here rather than in each overlay is deliberate: an audit found 54
     * fixed overlays hosting text fields, and hand-editing them would still
     * leave every overlay written next year broken.
     *
     * The reserved space is ADDED to whatever padding the overlay already has,
     * so a `pb-24` stays honoured, and the original inline value is restored on
     * close.
     */
    let paddedOverlay: { el: HTMLElement; original: string } | null = null;

    function releaseOverlay() {
      if (!paddedOverlay) return;
      paddedOverlay.el.style.paddingBottom = paddedOverlay.original;
      paddedOverlay = null;
    }

    function reserveOverlaySpace(inset: number) {
      const el = document.activeElement;
      if (!isTextControl(el)) return releaseOverlay();

      const overlay = nearestFixedOverlay(el);
      if (!overlay) return releaseOverlay();
      if (paddedOverlay && paddedOverlay.el !== overlay) releaseOverlay();

      if (!paddedOverlay) {
        // Measure BEFORE we touch it, or we would compound our own padding.
        const base = parseFloat(getComputedStyle(overlay).paddingBottom) || 0;
        paddedOverlay = { el: overlay, original: overlay.style.paddingBottom };
        overlay.dataset.kwKeyboardBase = String(base);
      }
      const base = parseFloat(paddedOverlay.el.dataset.kwKeyboardBase || '0') || 0;
      paddedOverlay.el.style.paddingBottom = `${base + inset}px`;
    }

    /**
     * Scroll the focused control into the space it actually has — but only as far
     * as its own top allows, so a tall textarea never has its label pushed off.
     *
     * THE SPACE IS NOT JUST "ABOVE THE KEYBOARD". A sheet keeps its action button
     * in a footer BELOW its scrolling body, so a field can clear the keyboard and
     * still sit behind "Post to the log". Measuring against the viewport alone
     * left the note box on the Shift Handover sheet showing one line of text.
     * The region is therefore the visual viewport INTERSECTED with the scroll
     * container's own box, which already excludes that footer.
     */
    function ensureVisible() {
      if (!vv) return;
      const el = document.activeElement;
      if (!isTextControl(el)) return;

      const scroller = nearestScrollable(el);
      const { delta } = scrollNeededFor(
        el.getBoundingClientRect(),
        { top: vv.offsetTop, bottom: vv.offsetTop + vv.height },
        scroller ? scroller.getBoundingClientRect() : null,
        SAFE_MARGIN_PX,
      );
      if (delta <= 0) return; // Already clear — never jump a field that is fine where it is.

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
        // Always drop a pending correction first. Android's Back can close the
        // keyboard inside the settle window, and a stale callback would then
        // scroll against whatever is focused by the time it fires.
        clearSettleTimers();
        if (inset === 0) {
          releaseOverlay();
          return;
        }
        // Reserve first: a fixed overlay must make room before there is anything
        // for the scroll pass to move.
        reserveOverlaySpace(inset);
        // Correct more than once. The keyboard animates in, and a sheet that
        // subtracts the keyboard from its own height re-lays-out as it does, so
        // a single early pass measures a geometry that no longer applies and
        // under-scrolls. Each pass returns immediately once the field is clear.
        for (const delay of SETTLE_PASSES_MS) {
          settleTimers.push(setTimeout(ensureVisible, delay));
        }
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
      clearSettleTimers();
      releaseOverlay();
      root.style.removeProperty('--keyboard-inset-bottom');
      root.style.removeProperty('--visual-viewport-height');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);

  return null;
}
