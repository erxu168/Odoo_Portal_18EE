'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Text that SHRINKS until it actually fits its box — measured, not guessed.
 *
 * A printed label has a fixed physical size, so the only honest way to size its
 * text is to render it and measure. Estimating from character counts (what the
 * location label did) is wrong the moment a word is long or a path is deep: the
 * text overflowed, the label clipped it, and the printer produced "DRY STORAG".
 *
 * Two rules that matter on a label:
 * - **A word is never broken.** `overflow-wrap: anywhere` splits STORAGE into
 *   STORAG + E, which is unreadable on a shelf. Words wrap whole or the type
 *   gets smaller.
 * - **`wordPerLine` puts each word on its own line**, which is what makes a
 *   two-word name print big: only the LONGEST WORD has to fit the width, not
 *   the whole phrase.
 *
 * Measure → binary-search the size → settle. Re-runs when the text or the box
 * changes (ResizeObserver), so switching label size re-fits everything.
 *
 * THE BOX MUST HAVE A DEFINITE SIZE — a fixed height, or a flex basis of 0 so it
 * takes the space left over. Give it a CONTENT-sized box (`flex: 0 0 auto`, or a
 * bare `max-height`) and it spirals: shrinking the text shrinks the box, which
 * leaves less room, which shrinks the text again, all the way to `minMm`.
 */
export default function FitText({
  text,
  maxMm,
  minMm = 2,
  wordPerLine = false,
  lineHeight = 1,
  className,
  style,
  title,
}: {
  text: string;
  /** Ceiling font size in mm — the size used when the text easily fits. */
  maxMm: number;
  /** Floor: below this it is unreadable anyway, so let it clip rather than vanish. */
  minMm?: number;
  /** Each word on its own line (a label name), instead of normal wrapping (a path). */
  wordPerLine?: boolean;
  lineHeight?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inkRef = useRef<HTMLDivElement | null>(null);
  const [mm, setMm] = useState(maxMm);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const ink = inkRef.current;
    if (!box || !ink) return;

    const fits = (candidate: number) => {
      ink.style.fontSize = `${candidate}mm`;
      // +0.5px of slack: sub-pixel rounding can report a 1-line block as
      // overflowing its own line box and shrink text that was already fine.
      return ink.scrollHeight <= box.clientHeight + 0.5
        && ink.scrollWidth <= box.clientWidth + 0.5;
    };

    const measure = () => {
      if (box.clientHeight <= 0 || box.clientWidth <= 0) return;   // not laid out yet
      if (fits(maxMm)) { ink.style.fontSize = ''; setMm(maxMm); return; }
      // Binary search the largest size that fits. 12 rounds resolves a 60 mm
      // range to well under a tenth of a millimetre — far finer than a printer.
      let lo = minMm;
      let hi = maxMm;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      ink.style.fontSize = '';       // hand control back to React's style prop
      // 2% back off. The fit is measured on SCREEN; the printer re-renders the
      // same mm box with its own font rasteriser, and a size that fits by a
      // hair here can spill by a hair there — which on a label means a clipped
      // word and a wasted sticker.
      setMm(Math.max(minMm, lo * 0.98));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text, maxMm, minMm, wordPerLine, lineHeight]);

  const words = wordPerLine ? text.trim().split(/\s+/).filter(Boolean) : null;

  return (
    <div ref={boxRef} className={className} style={{ ...style, overflow: 'hidden', minWidth: 0, minHeight: 0 }} title={title}>
      <div
        ref={inkRef}
        style={{
          fontSize: `${mm}mm`,
          lineHeight,
          // Never mid-word. A long single word is handled by shrinking, which is
          // what a person can still read.
          overflowWrap: 'normal',
          wordBreak: 'keep-all',
          hyphens: 'none',
        }}
      >
        {words
          ? words.map((w, i) => <div key={`${w}-${i}`}>{w}</div>)
          : text}
      </div>
    </div>
  );
}
