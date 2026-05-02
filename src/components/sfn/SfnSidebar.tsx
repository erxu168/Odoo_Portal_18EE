'use client';
import React from 'react';
import { SfnTab } from '@/app/sfn/page';
import { C } from '@/components/sfn/sfn-ui';

const NAV: { id: SfnTab; icon: string; label: string; badge?: number }[] = [
  { id: 'dashboard',  icon: '👥', label: 'Team-Übersicht', badge: 2 },
  { id: 'batch',      icon: '⚡', label: 'Batch generieren' },
  { id: 'individual', icon: '👤', label: 'Einzeln anpassen' },
  { id: 'simulator',  icon: '🔬', label: 'Was-wäre-wenn' },
  { id: 'settings',   icon: '⚙️', label: 'Einstellungen' },
];

interface Props { activeTab: SfnTab; onTabChange: (t: SfnTab) => void }

export default function SfnSidebar({ activeTab, onTabChange }: Props) {
  return (
    <div style={{
      width: 210, background: C.ink, display: 'flex', flexDirection: 'column',
      flexShrink: 0, overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{
        padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,.08)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 30, height: 30, background: C.orange, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff',
          fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0,
        }}>§3</div>
        <div>
          <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 600, lineHeight: 1.3 }}>SFN Optimizer</div>
          <div style={{ color: 'rgba(255,255,255,.35)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
            v2.0 · Odoo 18 EE
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: '10px 8px 4px' }}>
        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', padding: '0 8px 8px' }}>
          Navigation
        </div>
        {NAV.map(({ id, icon, label, badge }) => {
          const active = activeTab === id;
          return (
            <div
              key={id}
              onClick={() => onTabChange(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                color: active ? '#fff' : 'rgba(255,255,255,.55)',
                background: active ? C.orange : 'transparent',
                fontSize: 12.5, marginBottom: 1,
                transition: 'all .15s',
              }}
            >
              <span style={{ width: 15, textAlign: 'center', fontSize: 13 }}>{icon}</span>
              <span style={{ flex: 1 }}>{label}</span>
              {badge && (
                <span style={{
                  background: active ? 'rgba(255,255,255,.25)' : C.orange,
                  color: '#fff', fontSize: 10, fontWeight: 600,
                  padding: '1px 6px', borderRadius: 10,
                }}>
                  {badge}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Back to dashboard link */}
      <div style={{ padding: '8px 8px' }}>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 8 }}>
          <a
            href="/"
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
              color: 'rgba(255,255,255,.4)', fontSize: 12,
              textDecoration: 'none',
            }}
          >
            <span style={{ width: 15, textAlign: 'center' }}>←</span>
            Zurück zum Dashboard
          </a>
        </div>
      </div>

      <div style={{
        marginTop: 'auto', padding: '10px 12px',
        borderTop: '1px solid rgba(255,255,255,.08)',
        color: 'rgba(255,255,255,.25)', fontSize: 10.5,
        fontFamily: "'IBM Plex Mono', monospace",
      }}>
        Krawings GmbH · Berlin<br />§3b EStG 2026
      </div>
    </div>
  );
}
