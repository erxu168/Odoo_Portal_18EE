'use client';
import React, { useState } from 'react';
import {
  Employee, Schedule, OpeningHours, StaffingWindow, StaffingReq,
  ROLE_LABELS, DAYS_SHORT_DE,
} from '@/lib/sfn-engine';
import { C, Card, CardHeader, ROLE_COLORS } from '@/components/sfn/sfn-ui';

interface Props {
  year: number; month: number;
  employees: Employee[];
  schedules: Schedule[];
  openingHours: OpeningHours[];
  staffingWindows: StaffingWindow[];
  staffingReqs: StaffingReq[][];
}

export default function SfnTimeline({
  year, month, employees, schedules, openingHours, staffingWindows, staffingReqs,
}: Props) {
  const [selectedDay, setSelectedDay] = useState(7);
  const daysInMonth = new Date(year, month, 0).getDate();

  const dt = new Date(year, month - 1, selectedDay);
  const dow = dt.getDay();
  const dh = openingHours[dow];
  const startH = dh.open ? dh.startH : 9;
  const endH   = dh.open ? Math.min(dh.endH, 26) : 23;
  const hours  = Array.from({ length: endH - startH }, (_, i) => startH + i);

  // dayType for staffing reqs
  const dayType = dow === 0 ? 2 : (dow === 5 || dow === 6) ? 1 : 0;

  // Build shift map for this day
  const shiftMap = new Map<number, { startH: number; endH: number; role: string; sfnLst: number; passOne: boolean }>();
  schedules.forEach(sc => {
    const sh = sc.shifts.find(s => s.day === selectedDay);
    if (sh) shiftMap.set(sc.employeeId, { startH: sh.startH, endH: sh.endH, role: sh.role, sfnLst: sh.sfnLst, passOne: sh.passOne });
  });

  // Coverage per hour per role
  const cov: Record<string, number[]> = { kitchen: [], service: [], bar: [] };
  const req: Record<string, number[]> = { kitchen: [], service: [], bar: [] };
  hours.forEach((h, hi) => {
    (['kitchen', 'service', 'bar'] as const).forEach(role => {
      let cnt = 0;
      employees.forEach(emp => {
        const sh = shiftMap.get(emp.id);
        if (sh && h >= sh.startH && h < sh.endH) cnt++;
      });
      cov[role][hi] = cnt;
      let r = 0;
      staffingWindows.forEach((win, wi) => {
        if (h >= win.startH && h < (win.endH > 24 ? win.endH - 24 + 24 : win.endH)) {
          r = Math.max(r, staffingReqs[wi]?.[dayType]?.[role] || 0);
        }
      });
      req[role][hi] = r;
    });
  });

  const cellW = 100 / Math.max(hours.length, 1);

  // Day selector
  const dayOptions = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dt2 = new Date(year, month - 1, d);
    const dow2 = dt2.getDay();
    const dayName = DAYS_SHORT_DE[dow2];
    return { d, label: `${dayName} ${String(d).padStart(2, '0')}.03.` };
  });

  return (
    <Card style={{ padding: 14 }}>
      <CardHeader title={`Schichtplan-Timeline · ${String(selectedDay).padStart(2,'0')}.03.${year}`}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: C.ink3 }}>Tag:</span>
          <select
            value={selectedDay}
            onChange={e => setSelectedDay(parseInt(e.target.value))}
            style={{ padding: '3px 7px', fontSize: 11.5, border: `1px solid ${C.border2}`, borderRadius: 5, background: C.card }}
          >
            {dayOptions.map(({ d, label }) => <option key={d} value={d}>{label}</option>)}
          </select>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 8, fontSize: 10.5, alignItems: 'center', marginLeft: 8 }}>
            {(['kitchen','service','bar'] as const).map(r => (
              <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: ROLE_COLORS[r], display: 'inline-block' }} />
                {r === 'kitchen' ? 'Küche' : r === 'service' ? 'Service' : 'Bar'}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: 50, border: `2px solid ${C.orange}`, display: 'inline-block' }} />
              SFN
            </span>
          </div>
        </div>
      </CardHeader>

      {!dh.open ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.ink3, fontSize: 13 }}>
          ❌ Geschlossen an diesem Tag
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 600 }}>
            {/* Hour header */}
            <div style={{ display: 'flex', background: C.bg, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 120, flexShrink: 0, padding: '6px 10px', fontSize: 10, fontWeight: 700, color: C.ink3, textTransform: 'uppercase', borderRight: `1px solid ${C.border}` }}>
                Mitarbeiter
              </div>
              <div style={{ flex: 1, display: 'flex' }}>
                {hours.map(h => (
                  <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: C.ink3, fontFamily: "'IBM Plex Mono', monospace", padding: '6px 0', borderRight: `1px solid rgba(0,0,0,.04)` }}>
                    {String(h % 24).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>

            {/* Employee rows */}
            {employees.map(emp => {
              const sh = shiftMap.get(emp.id);
              return (
                <div key={emp.id} style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, minHeight: 34 }}>
                  <div style={{ width: 120, flexShrink: 0, padding: '6px 10px', fontSize: 11.5, fontWeight: 600, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                    <span>{emp.name.split(' ')[0]}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, color: ROLE_COLORS[emp.role] }}>
                      {emp.role === 'kitchen' ? '🍳' : emp.role === 'service' ? '🍽' : '🍸'}
                      {emp.flex ? ' (flex)' : ''}
                    </span>
                  </div>
                  <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                    {hours.map((h, hi) => (
                      <div key={h} style={{ flex: 1, height: '100%', borderRight: `1px solid rgba(0,0,0,.04)`, position: 'relative', minHeight: 34 }} />
                    ))}
                    {/* Shift bar */}
                    {sh && (() => {
                      const shStart = Math.max(sh.startH, startH);
                      const shEnd   = Math.min(sh.endH, endH);
                      const left    = ((shStart - startH) / hours.length) * 100;
                      const width   = ((shEnd - shStart) / hours.length) * 100;
                      const isSFN   = sh.sfnLst > 0;
                      return (
                        <div style={{
                          position: 'absolute',
                          left: `${left}%`, width: `${width}%`,
                          top: 4, bottom: 4,
                          background: ROLE_COLORS[sh.role],
                          borderRadius: 4,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 700, color: '#fff',
                          boxShadow: isSFN ? `0 0 0 2px rgba(245,128,10,.6)` : undefined,
                          overflow: 'hidden', whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }} title={`${emp.name}: ${sh.startH}:00–${sh.endH}:00${sh.passOne ? ' (Phase 1)' : ''}${isSFN ? ' · SFN' : ''}`}>
                          {sh.endH - sh.startH}h{sh.passOne ? ' P1' : ''}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}

            {/* Coverage rows */}
            {(['kitchen','service','bar'] as const).map(role => (
              <div key={role} style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                <div style={{ width: 120, flexShrink: 0, padding: '4px 10px', fontSize: 9.5, fontWeight: 700, color: ROLE_COLORS[role], borderRight: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                  {role === 'kitchen' ? '🍳 min K' : role === 'service' ? '🍽 min S' : '🍸 min B'}
                </div>
                <div style={{ flex: 1, display: 'flex' }}>
                  {hours.map((h, hi) => {
                    const actual = cov[role][hi] || 0;
                    const needed = req[role][hi] || 0;
                    const ok     = actual >= needed;
                    const warn   = actual === needed - 1;
                    const color  = needed === 0 ? C.ink3 : ok ? C.green : warn ? '#E8A000' : C.red;
                    return (
                      <div key={h} style={{ flex: 1, borderRight: `1px solid rgba(0,0,0,.04)`, padding: '2px 1px', display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                        <div style={{ height: 5, borderRadius: 2, width: '90%', background: needed === 0 ? C.border : ok ? C.green : warn ? '#E8A000' : C.red }} />
                        <div style={{ fontSize: 8, textAlign: 'center', color, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {actual}/{needed}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
