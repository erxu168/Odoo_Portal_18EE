'use client';

import React from 'react';

/**
 * Visual HTML preview — mirrors zpl.ts responsive percentages exactly.
 * Title: 9.3%, Body: 5.5%, Qty: 9%, Expiry: 18%, Meta: 3.5%
 */

interface LabelPreviewProps {
  productName: string;
  productReference?: string;
  productionDate: string;
  qty: number;
  uom: string;
  expiryDate: string;
  storageMode: 'chilled' | 'frozen' | 'ambient' | 'both' | null;
  lotName?: string;
  moName?: string;
  containerNumber?: number;
  totalContainers?: number;
  widthMm: number;
  heightMm: number;
}

/**
 * Match drawStorageIcon() in zpl.ts — same shapes, rendered as SVG so the
 * on-screen preview is honest about what the printer will emit.
 */
function StorageIcon({ mode, size }: { mode: 'chilled' | 'frozen' | 'ambient' | 'both'; size: number }) {
  const lt = Math.max(1.5, size * 0.09);
  const cx = size / 2;
  const cy = size / 2;

  if (mode === 'ambient') {
    const rC = size * 0.30;
    const rayInner = size * 0.36;
    const rayOuter = size * 0.48;
    const rays = [0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
      const a = (deg * Math.PI) / 180;
      return {
        x1: cx + Math.cos(a) * rayInner,
        y1: cy + Math.sin(a) * rayInner,
        x2: cx + Math.cos(a) * rayOuter,
        y2: cy + Math.sin(a) * rayOuter,
      };
    });
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={rC} fill="none" stroke="#1a1a1a" strokeWidth={lt} />
        {rays.map((r, i) => (
          <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke="#1a1a1a" strokeWidth={lt} strokeLinecap="round" />
        ))}
      </svg>
    );
  }

  // Snowflake (chilled / frozen / both); frozen gets an outline box around it
  const boxed = mode === 'frozen';
  const armRadius = size * (boxed ? 0.34 : 0.46);
  const half = size * 0.46;
  const arms = [0, 45, 90, 135].map(deg => {
    const a = (deg * Math.PI) / 180;
    return {
      x1: cx - Math.cos(a) * armRadius,
      y1: cy - Math.sin(a) * armRadius,
      x2: cx + Math.cos(a) * armRadius,
      y2: cy + Math.sin(a) * armRadius,
    };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {boxed && (
        <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2}
          fill="none" stroke="#1a1a1a" strokeWidth={lt} />
      )}
      {arms.map((a, i) => (
        <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="#1a1a1a" strokeWidth={lt} strokeLinecap="round" />
      ))}
    </svg>
  );
}

export default function LabelPreview({
  productName, productReference, productionDate, qty, uom, expiryDate, storageMode,
  lotName, moName, containerNumber, totalContainers,
  widthMm, heightMm,
}: LabelPreviewProps) {
  const px = 2.5;
  const w = widthMm * px;
  const h = heightMm * px;
  const margin = 2 * px;
  const gap = h * 0.012;

  // Same percentages as zpl.ts
  const titlePx = h * 0.121;
  const refPx = h * 0.0605;   // half of title
  const bodyPx = h * 0.0715;
  const qtyPx = h * 0.09;
  const expPx = h * 0.144;
  const metaPx = h * 0.035;
  const sepH = Math.max(1, h * 0.005);

  const hasProductionDate = !!(productionDate && productionDate.trim());
  const hasQty = qty !== 0 || !!(uom && uom.trim());
  const hasExpiry = !!(expiryDate && expiryDate.trim());
  const hasMeta = !!moName && containerNumber != null && totalContainers != null;
  const hasLot = !!lotName;
  const storageText =
    storageMode === 'both' ? 'COOLED & FROZEN' :
    storageMode === 'chilled' ? 'COOLED' :
    storageMode === 'frozen' ? 'FROZEN' :
    storageMode === 'ambient' ? 'AMBIENT' : null;
  const hasStorage = storageText != null && storageMode != null;

  // Barcode space estimate (only count rows that will render)
  const renderedRows =
    (hasProductionDate ? bodyPx : 0) +
    (hasQty ? qtyPx : 0) +
    (hasStorage ? bodyPx * 1.6 : 0) +
    (hasExpiry ? expPx : 0) +
    (hasMeta ? metaPx : 0) +
    (hasLot ? metaPx : 0);
  const textH = titlePx * 2.5 + sepH + gap * 6 + renderedRows + margin * 2;
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

        {/* Product reference — half the title size */}
        {productReference && productReference.trim() && (
          <div style={{
            fontSize: refPx,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gap,
            wordBreak: 'break-word',
          }}>
            {productReference}
          </div>
        )}

        {/* Separator */}
        <div style={{
          height: sepH,
          backgroundColor: '#1a1a1a',
          marginBottom: gap,
          flexShrink: 0,
        }} />

        {/* Production Date — normal */}
        {hasProductionDate && (
          <div style={{
            fontSize: bodyPx,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gap,
          }}>
            Produced: {productionDate}
          </div>
        )}

        {/* Quantity — emphasized */}
        {hasQty && (
          <div style={{
            fontSize: qtyPx,
            fontWeight: 700,
            color: '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: gap,
          }}>
            Qty: {qty}{uom ? ` ${uom}` : ''}
          </div>
        )}

        {/* Storage mode — pictogram + label, same weight as Expiry */}
        {hasStorage && storageMode && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: bodyPx * 0.5,
            marginBottom: gap,
          }}>
            <StorageIcon mode={storageMode} size={bodyPx * 1.6} />
            <div style={{
              fontSize: bodyPx,
              fontWeight: 800,
              color: '#1a1a1a',
              lineHeight: 1.1,
              letterSpacing: '0.04em',
            }}>
              {storageText}
            </div>
          </div>
        )}

        {/* Expiry — HUGE 2x emphasis; hidden when blank */}
        {hasExpiry && (
          <div style={{
            fontSize: expPx,
            fontWeight: 800,
            color: '#1a1a1a',
            lineHeight: 1.1,
            marginBottom: gap,
          }}>
            Exp: {expiryDate}
          </div>
        )}

        {/* MO + Container — small meta */}
        {hasMeta && (
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
        {hasLot && (
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
