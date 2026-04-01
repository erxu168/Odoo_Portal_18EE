'use client';
import React, { useMemo, useState } from 'react';
import {
  Employee, OpeningHours, StaffingWindow, StaffingReq,
  generateTeamSchedule, getBerlinHolidays, fmt, ROLE_LABELS,
  MONTHS_DE, Scenario,
} from '@/lib/sfn-engine';
import {
  C, Card, CardHeader, Btn, Badge, Alert, StatBox, StatStrip,
  TopBar, Content, SectionTitle, ROLE_COLORS, ROLE_BG,
} from '@/components/sfn/sfn-ui';
import { SfnTab } from '@/app/sfn/page';
import SfnTimeline from '@/components/sfn/SfnTimeline';

interface Props {
  year: number; month: number;
  employees: Employee[];
  openingHours: OpeningHours[];
  staffingWindows: StaffingWindow[];
  staffingReqs: StaffingReq[][];
  holidays: Set<string>;
  onTabChange: (t: SfnTab) => void;
}

const STATUS_BADGE: Record<string, 'pending' | 'confirmed' | 'locked'> = {
  pending: 'pending', confirmed: 'confirmed', locked: 'locked',
};
const STATUS_LABELS: Record<string, string> = {
  pending: 'Wartet', confirmed: 'Bestätigt', locked: 'Gesperrt',
};
// Simulated statuses — will come from Odoo API
const DEMO_STATUS: Record<number, string> = {
  1: 'pending', 2: 'pending', 3: 'confirmed', 4: 'confirmed',
  5: 'confirmed', 6: 'confirmed', 7: 'confirmed', 8: 'locked',
};

export default function SfnDashboard({
  year, month, employees, openingHours, staffingWindows, staffingReqs, holidays, onTabChange,
}: Props) {
  const [view, setView] = useState<'summary' | 'timeline'>('summary');
  const [scenario] = useState<Scenario>('balanced');

  const result = useMemo(() =>
    generateTeamSchedule(year, month, employees, openingHours, staffingWindows, staffingReqs, holidays, scenario),
    [year, month, employees, openingHours, staffingWindows, staffingReqs, holidays, scenario]
  );

  const pendingCount = employees.filter(e => DEMO_STATUS[e.id] === 'pending').length;
  const monthLabel = MONTHS_DE[month - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <TopBar title="Team-Übersicht" sub={`${monthLabel} ${year} · Krawings SSAM Berlin`}>
        <select style={{ padding: '4px 8px', fontSize: 11.5, border: `1px solid ${C.border2}`, borderRadius: 5, background: C.card }}>
          <option>Krawings SSAM Berlin</option>
          <option>Krawings Mitte</option>
        </select>
        <select style={{ padding: '4px 8px', fontSize: 11.5, border: `1px solid ${C.border2}`, borderRadius: 5, background: C.card }}>
          <option>März 2026</option>
          <option>April 2026</option>
        </select>
        <Btn variant="primary" size="sm" onClick={() => onTabChange('batch')}>⚡ Neu generieren</Btn>
      </TopBar>

      <Content>
        {/* Stats */}
        <StatStrip cols={5}>
          <StatBox label="Mitarbeiter" value={`${employees.length}`} sub="im Schichtplan" />
          <StatBox label="SFN gesamt" value={fmt(result.totalSFN)} sub="§3b LSt-frei" valueColor={C.orange} />
          <StatBox label="Brutto gesamt" value={fmt(result.totalGross)} />
          <StatBox label="Netto gesamt" value={fmt(result.totalNet)} valueColor={C.green} />
          <StatBox label="Ausstehend" value={`${pendingCount} / ${employees.length}`} sub="warten auf Bestätigung" valueColor={pendingCount > 0 ? '#E8A000' : C.green} />
        </StatStrip>

        {/* Coverage gaps */}
        {result.gaps.length > 0 && (
          <div style={{
            background: C.yellowL, border: `1.5px solid #E8C84A`, borderRadius: 7,
            padding: '12px 14px', marginBottom: 14,
          }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: '#7A5800', marginBottom: 6 }}>
              ⚠ {result.gaps.length} Besetzungslücken erkannt — Ihre Entscheidung erforderlich
            </div>
            {result.gaps.slice(0, 3).map((gap, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: '#7A5800' }}>
                <span>{gap.role === 'kitchen' ? '🍳' : gap.role === 'service' ? '🍽' : '🍸'}</span>
                <span>
                  <strong>{ROLE_LABELS[gap.role]}</strong> · {gap.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ·{' '}
                  {String(gap.startH).padStart(2, '0')}:00–{String(gap.endH % 24).padStart(2, '0')}:00 ·{' '}
                  {gap.actual} von min. {gap.required} besetzt
                </span>
                <Btn size="sm" variant="warning" onClick={() => onTabChange('individual')} style={{ marginLeft: 'auto' }}>
                  Lösen
                </Btn>
              </div>
            ))}
            {result.gaps.length > 3 && (
              <div style={{ fontSize: 11, color: '#7A5800', marginTop: 4 }}>
                + {result.gaps.length - 3} weitere Lücken
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `2px solid ${C.border}`, marginBottom: 18 }}>
          {[
            { id: 'summary' as const, label: '📊 Zusammenfassung' },
            { id: 'timeline' as const, label: '📅 Drilldown Timeline' },
          ].map(t => (
            <div
              key={t.id}
              onClick={() => setView(t.id)}
              style={{
                padding: '9px 16px', fontSize: 12, fontWeight: view === t.id ? 600 : 500,
                color: view === t.id ? C.orange : C.ink3,
                borderBottom: `2px solid ${view === t.id ? C.orange : 'transparent'}`,
                marginBottom: -2, cursor: 'pointer',
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* Summary table */}
        {view === 'summary' && (
          <Card>
            <CardHeader title={`Alle Mitarbeiter · ${monthLabel} ${year}`}>
              <Btn size="sm" variant="ghost">↓ CSV</Btn>
              <Btn size="sm" variant="secondary">🖨 Alle Gehaltszettel</Btn>
            </CardHeader>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Name','Rolle','Phase 1','Phase 2','Stunden','SFN §3b','Brutto','Netto','+Vorteil','Status','PDF'].map(h => (
                      <th key={h} style={{
                        background: C.bg, border: `1px solid ${C.border}`,
                        padding: '7px 10px', textAlign: h === 'Name' ? 'left' : 'right',
                        fontSize: 10.5, fontWeight: 600, color: C.ink3,
                        textTransform: 'uppercase', letterSpacing: '.05em',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.schedules.map(sc => {
                    const emp = employees.find(e => e.id === sc.employeeId)!;
                    const status = DEMO_STATUS[emp.id] || 'draft';
                    const noSFNNet = sc.net.net - (sc.totalSFN > 0 ? sc.totalSFN * 0.25 : 0); // approx
                    const advantage = sc.totalSFN * 0.25; // rough estimate
                    const roleKey = emp.role as keyof typeof ROLE_LABELS;
                    return (
                      <tr key={sc.employeeId} style={{ cursor: 'pointer' }} onClick={() => onTabChange('individual')}>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', fontWeight: 600, fontSize: 12 }}>
                          {emp.name}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px' }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 7px', borderRadius: 4,
                            fontSize: 10.5, fontWeight: 600,
                            background: ROLE_BG[emp.role], color: ROLE_COLORS[emp.role],
                          }}>
                            {ROLE_LABELS[roleKey]}
                          </span>
                          {emp.flex && (
                            <span style={{ marginLeft: 3, padding: '2px 6px', borderRadius: 4, fontSize: 9.5, background: '#F0F0F0', color: C.ink2, fontWeight: 600 }}>
                              flex
                            </span>
                          )}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {sc.coverageShifts}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {sc.sfnShifts}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {sc.totalH}h
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.orange }}>
                          +{fmt(sc.totalSFN)}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {fmt(sc.totalGross)}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.green }}>
                          {fmt(sc.net.net)}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.green }}>
                          +{fmt(advantage)}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'center' }}>
                          <Badge variant={STATUS_BADGE[status] || 'draft'}>
                            {STATUS_LABELS[status] || 'Entwurf'}
                          </Badge>
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '8px 10px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                            <Btn size="sm" variant="ghost">📄</Btn>
                            <Btn size="sm" variant="ghost">🖨</Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: C.bg, fontWeight: 700 }}>
                    <td colSpan={5} style={{ border: `1px solid ${C.border}`, padding: '9px 10px', fontSize: 12 }}>GESAMT</td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '9px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.orange }}>
                      +{fmt(result.totalSFN)}
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '9px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                      {fmt(result.totalGross)}
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '9px 10px', textAlign: 'right', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.green }}>
                      {fmt(result.totalNet)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        {/* Timeline */}
        {view === 'timeline' && (
          <SfnTimeline
            year={year} month={month}
            employees={employees}
            schedules={result.schedules}
            openingHours={openingHours}
            staffingWindows={staffingWindows}
            staffingReqs={staffingReqs}
          />
        )}
      </Content>
    </div>
  );
}
