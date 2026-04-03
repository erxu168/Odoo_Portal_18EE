'use client';

import React from 'react';

/**
 * Visual HTML preview of a Zebra label.
 * Renders a scaled-down representation matching the selected label size.
 * Shows: product name, production date, qty+UOM, expiry, lot, barcode area.
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
  // Scale: 1mm = 2.5px on screen (gives a nice preview size)
  const scale = 2.5;
  const w = widthMm * scale;
  const h = heightMm * scale;
  const isSmall = heightMm < 40;
  const isMedium = heightMm >= 40 && heightMm < 80;

  // Font sizes relative to label height
  const titleSize = isSmall ? 11 : isMedium ? 14 : 16;
  const bodySize = isSmall ? 9 : isMedium ? 11 : 13;
  const metaSize = isSmall ? 8 : isMedium ? 9 : 11;
  const padding = isSmall ? 6 : 10;

  return (
    <div className="flex flex-col items-center">
      {/* Label card */}
      <div
        style={{
          width: w,
          height: h,
          padding,
          border: '2px solid #1F2933',
          borderRadius: 4,
          backgroundColor: '#FFFFFF',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        {/* Product name */}
        <div style={{
          fontSize: titleSize,
          fontWeight: 800,
          color: '#1F2933',
          lineHeight: 1.1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: isSmall ? 'nowrap' : undefined,
          maxHeight: isSmall ? titleSize + 2 : titleSize * 2.2 + 4,
        }}>
          {productName}
        </div>

        {/* Separator */}
        {!isSmall && (
          <div style={{ borderTop: '1px solid #D1D5DB', margin: '3px 0' }} />
        )}

        {/* Fields */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: isSmall ? 1 : 2 }}>
          <div style={{ fontSize: bodySize, color: '#374151' }}>
            <span style={{ color: '#9CA3AF' }}>Produced:</span> {productionDate}
          </div>
          <div style={{ fontSize: bodySize, color: '#374151', fontWeight: 700 }}>
            <span style={{ color: '#9CA3AF', fontWeight: 400 }}>Qty:</span> {qty} {uom}
          </div>
          <div style={{ fontSize: bodySize, color: '#374151' }}>
            <span style={{ color: '#9CA3AF' }}>Expiry:</span> {expiryDate}
          </div>

          {!isSmall && moName && containerNumber && totalContainers && (
            <div style={{ fontSize: metaSize, color: '#6B7280' }}>
              {moName} | {containerNumber}/{totalContainers}
            </div>
          )}

          {!isSmall && lotName && (
            <div style={{ fontSize: metaSize, color: '#6B7280' }}>
              Lot: {lotName}
            </div>
          )}
        </div>

        {/* Barcode area (large labels only) */}
        {heightMm >= 76 && (
          <div style={{
            marginTop: 4,
            height: Math.min(30, h * 0.18),
            background: 'repeating-linear-gradient(90deg, #1F2933 0px, #1F2933 2px, transparent 2px, transparent 4px, #1F2933 4px, #1F2933 5px, transparent 5px, transparent 8px)',
            borderRadius: 2,
            opacity: 0.7,
          }} />
        )}
      </div>

      {/* Size caption */}
      <div className="mt-2 text-center">
        <span className="text-[var(--fs-xs)] text-gray-400 font-mono">
          {widthMm}\u00d7{heightMm}mm
        </span>
      </div>
    </div>
  );
}
