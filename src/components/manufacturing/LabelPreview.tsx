'use client';

import React from 'react';

/**
 * Visual HTML preview of a Zebra label.
 * 
 * MIRRORS the ZPL generator (src/lib/zpl.ts) exactly:
 * - Same responsive percentages of label height for font sizes
 * - Same layout order: title → separator → produced → qty → expiry → MO → lot → barcode
 * - Same 2mm margin, 0.8mm gap
 * 
 * When zpl.ts changes, update the percentages here to match.
 */

interface LabelPreviewProps {
  productName: string;
  productionDate: string;
  qty: number;
  uom: string;
  expiryDate: string;
  lotName?: string;
  moName?: string;
  containerNumber?: number;
  totalContainers?: number;
  widthMm: number;
  heightMm: number;
}

export default function LabelPreview({
  productName, productionDate, qty, uom, expiryDate,
  lotName, moName, containerNumber, totalContainers,
  widthMm, heightMm,
}: LabelPreviewProps) {
  // Scale: mm → CSS pixels (2.5px per mm gives a good on-screen size)
  const pxPerMm = 2.5;
  const w = widthMm * pxPerMm;
  const h = heightMm * pxPerMm;
  const marginPx = 2 * pxPerMm;  // 2mm margin (matches ZPL)
  const gapPx = 0.8 * pxPerMm;   // 0.8mm gap (matches ZPL)

  // Responsive font sizes — SAME percentages as zpl.ts
  const titleFontPx = h * 0.093;  // 9.3% of height per line
  const bodyFontPx = h * 0.06;    // 6% — production date
  const emphFontPx = h * 0.073;   // 7.3% — qty + expiry (emphasized)
  const metaFontPx = h * 0.04;    // 4% — MO, lot
  const sepH = Math.max(1, h * 0.005); // separator thickness

  // Estimate barcode height: whatever remains after text content
  // Rough calc matching ZPL: title(2 lines) + sep + produced + qty + expiry + meta*2 + gaps
  const textHeight = titleFontPx * 2.2 + sepH + gapPx * 8 +
    bodyFontPx + emphFontPx * 2 + metaFontPx * 2 + marginPx * 2;
  const barcodeH = Math.max(0, h - textHeight - marginPx);
  const showBarcode = barcodeH > (8 * pxPerMm);

  return (
    <div className="flex flex-col items-center">
      <div
        style={{
          width: w,
          height: h,
          padding: marginPx,
          border: '1.5px solid #333',
          borderRadius: 3,
          backgroundColor: '#FFFFFF',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Product Name (large, wrapping) ── */}
        <div style={{
          fontSize: titleFontPx,
          fontWeight: 800,
          color: '#1a1a1a',
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          marginBottom: gapPx,
          wordBreak: 'break-word',
        }}>
          {productName}
        </div>

        {/* ── Separator ── */}
        <div style={{
          height: sepH,
          backgroundColor: '#1a1a1a',
          marginBottom: gapPx,
          flexShrink: 0,
        }} />

        {/* ── Production Date (normal body) ── */}
        <div style={{
          fontSize: bodyFontPx,
          color: '#1a1a1a',
          lineHeight: 1.2,
          marginBottom: gapPx,
        }}>
          Produced: {productionDate}
        </div>

        {/* ── Quantity (emphasized — larger) ── */}
        <div style={{
          fontSize: emphFontPx,
          fontWeight: 700,
          color: '#1a1a1a',
          lineHeight: 1.2,
          marginBottom: gapPx,
        }}>
          Qty: {qty} {uom}
        </div>

        {/* ── Expiry Date (emphasized — larger) ── */}
        <div style={{
          fontSize: emphFontPx,
          fontWeight: 700,
          color: '#1a1a1a',
          lineHeight: 1.2,
          marginBottom: gapPx * 2,
        }}>
          Expiry: {expiryDate}
        </div>

        {/* ── MO + Container (meta — small) ── */}
        {moName && containerNumber != null && totalContainers != null && (
          <div style={{
            fontSize: metaFontPx,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gapPx,
          }}>
            {moName} | {containerNumber}/{totalContainers}
          </div>
        )}

        {/* ── Lot (meta — small) ── */}
        {lotName && (
          <div style={{
            fontSize: metaFontPx,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gapPx,
          }}>
            Lot: {lotName}
          </div>
        )}

        {/* ── Spacer to push barcode to bottom ── */}
        <div style={{ flex: 1 }} />

        {/* ── Barcode (fills remaining bottom space) ── */}
        {showBarcode && (
          <div style={{
            height: Math.min(barcodeH, 15 * pxPerMm),
            background: `repeating-linear-gradient(90deg, 
              #1a1a1a 0px, #1a1a1a 1.5px, 
              transparent 1.5px, transparent 3px, 
              #1a1a1a 3px, #1a1a1a 4px, 
              transparent 4px, transparent 5.5px,
              #1a1a1a 5.5px, #1a1a1a 6px,
              transparent 6px, transparent 9px)`,
            opacity: 0.85,
            flexShrink: 0,
          }} />
        )}
      </div>

      {/* Size caption */}
      <div className="mt-2 text-center">
        <span className="text-[var(--fs-xs)] text-gray-400 font-mono">
          {widthMm} {'\u00d7'} {heightMm} mm
        </span>
      </div>
    </div>
  );
}
