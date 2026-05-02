'use client';
import React from 'react';

// ── DESIGN TOKENS ─────────────────────────────────────────────
export const C = {
  orange:    '#F5800A',
  orangeH:   '#E86000',
  orangeL:   '#FFF4E6',
  orangeDim: '#7A3800',
  ink:       '#1A1A1A',
  ink2:      '#444',
  ink3:      '#888',
  border:    '#E2E2E2',
  border2:   '#C8C8C8',
  bg:        '#F7F7F5',
  card:      '#FFFFFF',
  green:     '#1A9150',
  greenL:    '#E8F5EE',
  red:       '#C0392B',
  redL:      '#FDECEA',
  blue:      '#1565C0',
  blueL:     '#E3F0FF',
  yellowL:   '#FFFBEA',
  kitchen:   '#E85D04',
  kitchenL:  '#FFF0E6',
  service:   '#1565C0',
  serviceL:  '#E3F0FF',
  bar:       '#6B21A8',
  barL:      '#F3E8FF',
};

export const ROLE_COLORS: Record<string, string> = {
  kitchen: C.kitchen,
  service: C.service,
  bar:     C.bar,
};
export const ROLE_BG: Record<string, string> = {
  kitchen: C.kitchenL,
  service: C.serviceL,
  bar:     C.barL,
};

// ── PRIMITIVES ────────────────────────────────────────────────

interface CardProps { children: React.ReactNode; style?: React.CSSProperties }
export function Card({ children, style }: CardProps) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 18, ...style
    }}>
      {children}
    </div>
  );
}

interface CardHeaderProps { title: string; children?: React.ReactNode }
export function CardHeader({ title, children }: CardHeaderProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      {children && <div style={{ display: 'flex', gap: 6 }}>{children}</div>}
    </div>
  );
}

interface BtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'warning';
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
  disabled?: boolean;
}
export function Btn({ children, onClick, variant = 'secondary', size = 'md', style, disabled }: BtnProps) {
  const bg: Record<string, string> = {
    primary: C.orange, secondary: C.card, ghost: 'transparent',
    success: C.green, warning: '#E8A000',
  };
  const color: Record<string, string> = {
    primary: '#fff', secondary: C.ink2, ghost: C.ink3,
    success: '#fff', warning: '#fff',
  };
  const border: Record<string, string> = {
    primary: 'none', secondary: `1px solid ${C.border2}`,
    ghost: `1px solid ${C.border}`, success: 'none', warning: 'none',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: size === 'sm' ? '4px 9px' : '6px 13px',
        borderRadius: 5,
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 500, fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? C.bg : bg[variant],
        color: disabled ? C.ink3 : color[variant],
        border: border[variant],
        opacity: disabled ? 0.6 : 1,
        transition: 'all .15s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'draft' | 'pending' | 'confirmed' | 'locked' | 'kitchen' | 'service' | 'bar' | 'warn' | 'ok' | 'flex';
  style?: React.CSSProperties;
}
export function Badge({ children, variant = 'draft', style }: BadgeProps) {
  const styles: Record<string, React.CSSProperties> = {
    draft:     { background: '#F0F0F0', color: C.ink3 },
    pending:   { background: C.yellowL, color: '#7A5800', border: `1px solid #E8C84A` },
    confirmed: { background: C.greenL, color: C.green },
    locked:    { background: C.blueL, color: C.blue },
    kitchen:   { background: C.kitchenL, color: C.kitchen },
    service:   { background: C.serviceL, color: C.service },
    bar:       { background: C.barL, color: C.bar },
    warn:      { background: C.yellowL, color: '#7A5800', border: `1px solid #E8C84A` },
    ok:        { background: C.greenL, color: C.green },
    flex:      { background: '#F0F0F0', color: C.ink2 },
  };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 10.5, fontWeight: 600,
      ...styles[variant], ...style,
    }}>
      {children}
    </span>
  );
}

interface AlertProps {
  children: React.ReactNode;
  variant?: 'info' | 'warn' | 'ok' | 'err';
  style?: React.CSSProperties;
}
export function Alert({ children, variant = 'info', style }: AlertProps) {
  const styles: Record<string, React.CSSProperties> = {
    info: { background: C.blueL, color: C.blue, border: `1px solid #90B8E8` },
    warn: { background: C.yellowL, color: '#7A5800', border: `1px solid #E8C84A` },
    ok:   { background: C.greenL, color: C.green, border: `1px solid #80C8A0` },
    err:  { background: C.redL, color: C.red, border: `1px solid #E8A0A0` },
  };
  return (
    <div style={{
      padding: '9px 12px', borderRadius: 6, fontSize: 11.5,
      marginBottom: 12, display: 'flex', alignItems: 'flex-start',
      gap: 7, lineHeight: 1.5, ...styles[variant], ...style,
    }}>
      {children}
    </div>
  );
}

interface StatBoxProps { label: string; value: string; sub?: string; valueColor?: string }
export function StatBox({ label, value, sub, valueColor }: StatBoxProps) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 7, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10.5, color: C.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        fontSize: 19, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace",
        color: valueColor || C.ink,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: C.ink3, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

interface StatStripProps { children: React.ReactNode; cols?: number }
export function StatStrip({ children, cols = 4 }: StatStripProps) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 10, marginBottom: 18,
    }}>
      {children}
    </div>
  );
}

interface TwoColProps { children: React.ReactNode; style?: React.CSSProperties }
export function TwoCol({ children, style }: TwoColProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, ...style }}>
      {children}
    </div>
  );
}

export function Divider({ style }: { style?: React.CSSProperties }) {
  return <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '14px 0', ...style }} />;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '.08em', color: C.ink3, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

interface FormGroupProps {
  label: string;
  children: React.ReactNode;
  hint?: string;
  style?: React.CSSProperties;
}
export function FormGroup({ label, children, hint, style }: FormGroupProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, ...style }}>
      <label style={{
        fontSize: 10.5, fontWeight: 600, color: C.ink2,
        textTransform: 'uppercase', letterSpacing: '.05em',
      }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: C.ink3 }}>{hint}</span>}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  padding: '7px 9px', border: `1px solid ${C.border2}`, borderRadius: 5,
  fontSize: 12.5, fontFamily: 'inherit', background: C.card, color: C.ink, outline: 'none',
};

export const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

// ── TOP BAR ───────────────────────────────────────────────────
interface TopBarProps {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}
export function TopBar({ title, sub, children }: TopBarProps) {
  return (
    <div style={{
      height: 50, background: C.card, borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', padding: '0 18px',
      gap: 10, flexShrink: 0,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.ink3, fontFamily: "'IBM Plex Mono', monospace" }}>{sub}</div>}
      </div>
      {children && <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}

// ── CONTENT WRAPPER ───────────────────────────────────────────
export function Content({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
      {children}
    </div>
  );
}

// ── RESULT ROW ────────────────────────────────────────────────
interface ResRowProps { label: string; value: string; valueColor?: string; bold?: boolean }
export function ResRow({ label, value, valueColor, bold }: ResRowProps) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 0', borderBottom: `1px solid rgba(0,0,0,.05)`, fontSize: 12,
      fontWeight: bold ? 700 : 400,
    }}>
      <span style={{ color: C.ink3 }}>{label}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: valueColor || C.ink }}>
        {value}
      </span>
    </div>
  );
}

// ── MINI CALENDAR ─────────────────────────────────────────────
import { Shift, DAYS_SHORT_DE, SHIFT_TYPE_LABELS } from '@/lib/sfn-engine';

const SHIFT_BG: Record<string, string> = {
  normal: C.orange, night: '#6366F1', sunday: '#D97706', holiday: C.red,
};

interface MiniCalendarProps { shifts: Shift[]; year: number; month: number; role?: string }
export function MiniCalendar({ shifts, year, month, role }: MiniCalendarProps) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const firstMon = firstDow === 0 ? 6 : firstDow - 1;
  const shiftMap = new Map<number, Shift>();
  shifts.forEach(s => shiftMap.set(s.day, s));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 10 }}>
        {DAYS_SHORT_DE.slice(1).concat(DAYS_SHORT_DE[0]).map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.ink3, padding: '3px 0' }}>
            {d}
          </div>
        ))}
        {Array.from({ length: firstMon }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = i + 1;
          const s = shiftMap.get(d);
          const bg = s ? SHIFT_BG[s.type] : C.bg;
          const color = s ? '#fff' : C.ink3;
          return (
            <div key={d} style={{
              background: bg, color, borderRadius: 3, padding: '2px 1px',
              textAlign: 'center', fontSize: 9, minHeight: 28,
              border: s?.passOne ? `2px solid rgba(0,0,0,.3)` : `1px solid ${C.border}`,
            }} title={s ? `${s.startH}:00–${s.endH}:00 · ${SHIFT_TYPE_LABELS[s.type]}${s.passOne ? ' (Phase 1)' : ''}` : ''}>
              <div style={{ fontWeight: 700 }}>{d}</div>
              {s && <div style={{ fontSize: 8 }}>{s.startH}–{s.endH % 24}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 10, color: C.ink3, flexWrap: 'wrap' }}>
        {Object.entries(SHIFT_BG).map(([type, bg]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: bg, display: 'inline-block' }} />
            {SHIFT_TYPE_LABELS[type as keyof typeof SHIFT_TYPE_LABELS]}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: C.orange, border: '2px solid rgba(0,0,0,.3)', display: 'inline-block' }} />
          Phase 1 (Besetzung)
        </span>
      </div>
    </div>
  );
}

// ── PAYROLL BREAKDOWN ─────────────────────────────────────────
import { NetResult, fmt } from '@/lib/sfn-engine';

interface PayrollBreakdownProps {
  gross: number; sfn: number; base: number; net: NetResult;
}
export function PayrollBreakdown({ gross, sfn, base, net }: PayrollBreakdownProps) {
  const noSFNComparison = sfn > 0;
  return (
    <TwoCol>
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 14 }}>
        <SectionTitle>Brutto → Abzüge</SectionTitle>
        <ResRow label="Grundlohn"        value={fmt(base)} />
        {sfn > 0 && <ResRow label="+ SFN §3b (LSt-frei)" value={'+' + fmt(sfn)} valueColor={C.orange} />}
        <ResRow label="= Brutto gesamt"  value={fmt(gross)} bold />
        <div style={{ height: 8 }} />
        <ResRow label="− Sozialversicherung (AN)" value={'−' + fmt(net.sv)} valueColor={C.red} />
        <ResRow label="− Lohnsteuer"     value={'−' + fmt(net.lst)} valueColor={C.red} />
        {net.soli > 0.01 && <ResRow label="− Soli" value={'−' + fmt(net.soli)} valueColor={C.red} />}
        <ResRow label="− Kirchensteuer"  value="0,00\u00a0€" valueColor={C.ink3} />
      </div>
      <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 6, padding: 14 }}>
        <SectionTitle>Netto</SectionTitle>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.green, fontFamily: "'IBM Plex Mono', monospace", textAlign: 'center', padding: '12px 0 4px' }}>
          {fmt(net.net)}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: C.ink3, marginBottom: 12 }}>AUSZAHLUNGSBETRAG</div>
        <Divider />
        {sfn > 0 && <>
          <ResRow label="SFN-Anteil am Brutto"  value={(sfn / gross * 100).toFixed(1) + '%'} valueColor={C.orange} />
          <ResRow label="Effektiver Std-Satz"   value={fmt(gross / Math.max(1, base / 15))} />
        </>}
        <ResRow label={net.category === 'mini' ? 'Minijob' : net.category === 'midi' ? 'Midijob (Gleitzone)' : 'Normal (SV-pflichtig)'} value="" />
      </div>
    </TwoCol>
  );
}
