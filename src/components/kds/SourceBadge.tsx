'use client';

import { SOURCES } from '@/types/kds';

interface SourceBadgeProps {
  dishName: string;
  fontSize?: number;
}

export default function SourceBadge({ dishName, fontSize }: SourceBadgeProps) {
  const src = SOURCES[dishName];
  if (!src) return null;
  return (
    <span
      className="kds-s-source"
      style={{ background: src.bg, color: src.color, fontSize: fontSize ? `${fontSize}px` : undefined }}
    >
      {src.label}
    </span>
  );
}
