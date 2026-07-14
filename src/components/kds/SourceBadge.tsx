'use client';

import { lookupSource } from '@/types/kds';
import { useKds } from '@/lib/kds/state';

interface SourceBadgeProps {
  dishName: string;
  fontSize?: number;
}

export default function SourceBadge({ dishName, fontSize }: SourceBadgeProps) {
  const { productConfig } = useKds();
  const src = lookupSource(dishName, productConfig);
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
