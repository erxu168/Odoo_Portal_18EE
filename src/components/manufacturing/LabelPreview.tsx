'use client';

import React from 'react';

/**
 * Visual HTML preview — mirrors zpl.ts responsive percentages exactly.
 * Title: 9.3%, Body: 5.5%, Qty: 9%, Expiry: 18%, Meta: 3.5%
 */

interface LabelPreviewProps {
  productName: string;
  productionDate: string;
  qty: number;
  uom: string;
  expiryDate: string;
  storageMode: 'chilled' | 'frozen';
  lotName?: string;
  moName?: string;
  containerNumber?: number;
  totalContainers?: number;
  widthMm: number;
  heightMm: number;
}

export default function LabelPreview({
  productName, productionDate, qty, uom, expiryDate, storageMode,
  lotName, moName, containerNumber, totalContainers,
  widthMm, heightMm,
}: LabelPreviewProps) {
  const px = 2.5;
  const w = widthMm * px;
  const h = heightMm * px;
  const margin = 2 * px;
  const gap = h * 0.012;

  // Same percentages as zpl.ts
  const titlePx = h * 0.093;
  const bodyPx = h * 0.055;
  const qtyPx = h * 0.09;
  const expPx = h * 0.18;   // 2x emphasis!
  const metaPx = h * 0.035;
  const sepH = Math.max(1, h * 0.005);

  // Barcode space estimate
  const textH = titlePx * 2.5 + sepH + gap * 8 + bodyPx + qtyPx + expPx + metaPx * 2 + margin * 2;
  const barcodeH = Math.max(0, h - textH - margin);
  const showBarcode = barcodeH > (8 * px);

  return (
    <div className="flex flex-col items-center">
      <div
        style={{
          width: w,
          height: h,
          padding: margin,
          border: '1.5px solid #333',
          borderRadius: 3,
          backgroundColor: '#FFFFFF',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* Product Name — large, max ~3 lines */}
        <div style={{
          fontSize: titlePx,
          fontWeight: 800,
          color: '#1a1a1a',
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          marginBottom: gap,
          wordBreak: 'break-word',
          overflow: 'hidden',
          maxHeight: titlePx * 3.5,
        }}>
          {productName}
        </div>

        {/* Separator */}
        <div style={{
          height: sepH,
          backgroundColor: '#1a1a1a',
          marginBottom: gap,
          flexShrink: 0,
        }} />

        {/* Production Date — normal */}
        <div style={{
          fontSize: bodyPx,
          color: '#1a1a1a',
          lineHeight: 1.2,
          marginBottom: gap,
        }}>
          Produced: {productionDate}
        </div>

        {/* Quantity — emphasized */}
        <div style={{
          fontSize: qtyPx,
          fontWeight: 700,
          color: '#1a1a1a',
          lineHeight: 1.2,
          marginBottom: gap,
        }}>
          Qty: {qty} {uom}
        </div>

        {/* Storage mode — same weight as Expiry for visual pairing */}
        <div style={{
          fontSize: expPx,
          fontWeight: 800,
          color: '#1a1a1a',
          lineHeight: 1.1,
          marginBottom: gap,
        }}>
          STORE: {storageMode.toUpperCase()}
        </div>

        {/* Expiry — HUGE 2x emphasis; renders label even when date is blank */}
        <div style={{
          fontSize: expPx,
          fontWeight: 800,
          color: '#1a1a1a',
          lineHeight: 1.1,
          marginBottom: gap,
        }}>
          Exp: {expiryDate || ''}
        </div>

        {/* MO + Container — small meta */}
        {moName && containerNumber != null && totalContainers != null && (
          <div style={{
            fontSize: metaPx,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gap,
          }}>
            {moName} | {containerNumber}/{totalContainers}
          </div>
        )}

        {/* Lot — small meta */}
        {lotName && (
          <div style={{
            fontSize: metaPx,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gap,
          }}>
            Lot: {lotName}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Barcode */}
        {showBarcode && (
          <div style={{
            height: Math.min(barcodeH, 12 * px),
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

      <div className="mt-2 text-center">
        <span className="text-[var(--fs-xs)] text-gray-400 font-mono">
          {widthMm} {'\u00d7'} {heightMm} mm
        </span>
      </div>
    </div>
  );
}
