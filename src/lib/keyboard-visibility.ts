/**
 * How far to scroll a focused control out from behind the on-screen keyboard.
 *
 * Pure geometry, separated from ui/KeyboardViewportManager so the rule can be
 * tested against real measurements instead of only observed on a device.
 *
 * THE RULE THAT WAS WRONG FIRST TIME: "visible" is not "above the keyboard".
 * A bottom sheet keeps its action button in a footer BELOW its scrolling body,
 * so a field can clear the keyboard by 16px and still sit behind "Post to the
 * log". The space a control actually has is the visual viewport INTERSECTED
 * with its scroll container's box — which already excludes that footer.
 */

export interface Box {
  top: number;
  bottom: number;
}

export interface ScrollNeed {
  /** Region the control must fit inside, after intersecting viewport and scroller. */
  visibleTop: number;
  visibleBottom: number;
  /** Pixels to scroll down. 0 means it is already clear — do not move it. */
  delta: number;
}

/**
 * @param rect      the focused control's bounding box
 * @param viewport  the visual viewport (offsetTop..offsetTop+height)
 * @param scroller  the nearest scrollable ancestor's box, if there is one
 * @param margin    how much clear space the control needs below it
 */
export function scrollNeededFor(
  rect: Box,
  viewport: Box,
  scroller: Box | null,
  margin: number,
): ScrollNeed {
  let visibleTop = viewport.top;
  let visibleBottom = viewport.bottom;
  if (scroller) {
    visibleTop = Math.max(visibleTop, scroller.top);
    visibleBottom = Math.min(visibleBottom, scroller.bottom);
  }

  const overflow = rect.bottom - (visibleBottom - margin);
  if (overflow <= 0) return { visibleTop, visibleBottom, delta: 0 };

  // Capped by the control's own headroom, so a tall textarea never has its top —
  // and the label above it — pushed off the screen to reveal its bottom.
  const headroom = rect.top - (visibleTop + margin);
  const delta = Math.min(overflow, Math.max(headroom, 0));
  return { visibleTop, visibleBottom, delta: delta > 0 ? delta : 0 };
}
