import React from 'react';
import { HomeIcon, BackIcon } from './Icons';

interface PurchaseHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightElement?: React.ReactNode;
  goHome: () => void;
}

export default function PurchaseHeader({ title, subtitle, showBack, onBack, rightElement, goHome }: PurchaseHeaderProps) {
  return (
    <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative">
        <button onClick={showBack ? onBack : goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">{showBack ? <BackIcon /> : <HomeIcon />}</button>
        <div className="flex-1 min-w-0"><h1 className="text-[20px] font-bold text-white truncate">{title}</h1>{subtitle && <p className="text-[var(--fs-xs)] text-white/45 mt-0.5">{subtitle}</p>}</div>
        {rightElement}
        {showBack && !rightElement && <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors" title="Dashboard"><HomeIcon /></button>}
      </div>
    </div>
  );
}
