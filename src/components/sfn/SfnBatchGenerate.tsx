'use client';
import React, { useState, useMemo } from 'react';
import {
  Employee, OpeningHours, StaffingWindow, StaffingReq,
  generateTeamSchedule, calcMonthlyNet, fmt, ROLE_LABELS,
  MONTHS_DE, Scenario,
} from '@/lib/sfn-engine';
import {
  C, Card, CardHeader, Btn, Badge, Alert, StatStrip, StatBox,
  TopBar, Content, TwoCol, SectionTitle, FormGroup, selectStyle,
  ROLE_COLORS, ROLE_BG,
} from '@/components/sfn/sfn-ui';

interface Props {
  year: number; month: number;
  employees: Employee[];
  openingHours: OpeningHours[];
  staffingWindows: StaffingWindow[];
  staffingReqs: StaffingReq[][];
  holidays: Set<string>;
}

type PassState = 'idle' | 'pass1' | 'pass2' | 'done';

export default function SfnBatchGenerate({
  year, month, employees, openingHours, staffingWindows, staffingReqs, holidays,
}: Props) {
  const [scenario, setScenario] = useState<Scenario>('balanced');
  const [passState, setPassState] = useState<PassState>('idle');
  const [result, setResult] = useState<ReturnType<typeof generateTeamSchedule> | null>(null);
  const monthLabel = MONTHS_DE[month - 1];

  function handleGenerate() {
    setPassState('pass1');
    setTimeout(() => {
      setPassState('pass2');
      setTimeout(() => {
        const r = generateTeamSchedule(
          year, month, employees, openingHours,
          staffingWindows, staffingReqs, holidays, scenario
        );
        setResult(r);
        setPassState('done');
      }, 900);
    }, 800);
  }

  function handleConfirmAll() {
    alert(`✅ Alle ${employees.length} Schichtpläne wurden bestätigt.\nDer nächste Schritt wäre: Speicherung in Odoo 18 EE als sfn.schedule-Datensätze.`);
  }

  const passStep = (num: number, label: string, desc: string) => {
    const done  = (num === 1 && (passState === 'pass2' || passState === 'done')) || (num === 2 && passState === 'done');
    const active = (num === 1 && passState === 'pass1') || (num === 2 && passState === 'pass2') || (num === 3 && passState === 'done');
    return (
      <div style={{
        flex: 1, padding: '10px 14px',
        background: done ? C.greenL : active ? C.orangeL : C.bg,
        border: `1px solid ${done ? C.green : active ? C.orange : C.border}`,
        borderRadius: num === 1 ? '7px 0 0 7px' : num === 3 ? '0 7px 7px 0' : undefined,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", display: 'block', color: done ? C.green : active ? C.orange : C.ink3 }}>
          {done ? '✓' : num}
        </span>
        <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: done ? C.green : active ? C.orangeDim : C.ink3 }}>
          {label}
        </span>
        <div style={{ fontSize: 10, color: done ? C.green : active ? C.orangeDim : C.ink3, marginTop: 2 }}>{desc}</div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <TopBar title="Batch generieren" sub={`Zwei-Phasen-Planung · ${monthLabel} ${year} · Krawings SSAM Berlin`} />
      <Content>
        {/* Pass indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 18 }}>
          {passStep(1, 'Besetzungsdeckung', 'Min. Stellen füllen')}
          <div style={{ fontSize: 16, color: C.border2, flexShrink: 0, margin: '0 -1px', zIndex: 1 }}>→</div>
          {passStep(2, 'SFN-Optimierung', 'Restliche Std. für §3b')}
          <div style={{ fontSize: 16, color: C.border2, flexShrink: 0, margin: '0 -1px', zIndex: 1 }}>→</div>
          {passStep(3, 'Prüfung & Versand', 'ArbZG + Lücken + Bestätigung')}
        </div>

        <TwoCol>
          {/* Settings */}
          <Card>
            <CardHeader title="Batch-Einstellungen" />
            <div className="form-row" style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              <FormGroup label="Monat">
                <select style={selectStyle}><option>{monthLabel} {year}</option></select>
              </FormGroup>
              <FormGroup label="Standort">
                <select style={selectStyle}><option>Krawings SSAM Berlin</option><option>Krawings Mitte</option></select>
              </FormGroup>
            </div>
            <FormGroup label="Szenario (alle Mitarbeiter)" style={{ marginBottom: 14 }} hint="Einzelne Mitarbeiter können danach überschrieben werden">
              <div style={{ display: 'flex', gap: 7 }}>
                {([
                  { id: 'conservative' as Scenario, label: '🛡 Konservativ' },
                  { id: 'balanced'     as Scenario, label: '⚖️ Ausgewogen' },
                  { id: 'max'          as Scenario, label: '🚀 Max SFN' },
                ]).map(({ id, label }) => (
                  <div
                    key={id}
                    onClick={() => setScenario(id)}
                    style={{
                      flex: 1, padding: '6px 8px', borderRadius: 5, textAlign: 'center',
                      cursor: 'pointer', fontSize: 11.5, userSelect: 'none',
                      border: `1.5px solid ${scenario === id ? C.orange : C.border2}`,
                      background: scenario === id ? C.orangeL : C.card,
                      color: scenario === id ? C.orangeDim : C.ink2,
                      fontWeight: scenario === id ? 600 : 400,
                    }}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </FormGroup>

            <Alert variant="info">
              ℹ️ <div>
                <strong>Zwei-Phasen-Planung:</strong><br />
                <strong>Phase 1</strong> füllt die Mindestbesetzung aus dem Besetzungsplan (Küche / Service / Bar pro Zeitfenster).<br />
                <strong>Phase 2</strong> optimiert die restlichen Stunden jedes Mitarbeiters für maximales SFN §3b — innerhalb des Ziel-Bruttolohns und der ArbZG-Grenzen.
              </div>
            </Alert>

            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <Btn variant="primary" onClick={handleGenerate} disabled={passState === 'pass1' || passState === 'pass2'}>
                {passState === 'pass1' ? '⏳ Phase 1 läuft…' : passState === 'pass2' ? '⏳ Phase 2 läuft…' : '⚡ Für alle Mitarbeiter generieren'}
              </Btn>
            </div>
          </Card>

          {/* Employee list */}
          <Card>
            <CardHeader title={`Mitarbeiter · ${monthLabel} ${year}`} />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name','Rolle','Typ','GL €/h','Ziel Brutto'].map(h => (
                    <th key={h} style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '6px 8px', fontSize: 10.5, fontWeight: 600, color: C.ink3, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: h === 'Name' ? 'left' : 'right' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id}>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 12, fontWeight: 600 }}>{emp.name}</td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px' }}>
                      <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: ROLE_BG[emp.role], color: ROLE_COLORS[emp.role] }}>
                        {ROLE_LABELS[emp.role]}
                      </span>
                      {emp.flex && <span style={{ marginLeft: 3, padding: '2px 5px', borderRadius: 4, fontSize: 9.5, background: '#F0F0F0', color: C.ink2, fontWeight: 600 }}>flex</span>}
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 11.5, color: C.ink3 }}>VZ</td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                      {emp.grundlohn.toFixed(2)}
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                      {fmt(emp.target_brutto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TwoCol>

        {/* Results */}
        {result && passState === 'done' && (
          <Card>
            <CardHeader title="Generierungsergebnis">
              <Btn size="sm" variant="secondary">🖨 Alle Nachweis</Btn>
              <Btn size="sm" variant="success" onClick={handleConfirmAll}>✓ Alle bestätigen & senden</Btn>
            </CardHeader>

            {result.gaps.length > 0 ? (
              <Alert variant="warn">
                ⚠️ <div>
                  <strong>{result.gaps.length} Besetzungslücken</strong> wurden erkannt und markiert.
                  ArbZG überprüft. Ihre Entscheidung erforderlich.
                </div>
              </Alert>
            ) : (
              <Alert variant="ok">
                ✅ <div>
                  {employees.length} Schichtpläne generiert · ArbZG überprüft ·
                  Mindestbesetzung: <strong>100% erfüllt</strong> · Keine Lücken.
                </div>
              </Alert>
            )}

            <StatStrip cols={4}>
              <StatBox label="SFN gesamt" value={fmt(result.totalSFN)} valueColor={C.orange} sub="§3b LSt-frei" />
              <StatBox label="Brutto gesamt" value={fmt(result.totalGross)} />
              <StatBox label="Netto gesamt" value={fmt(result.totalNet)} valueColor={C.green} />
              <StatBox label="Lücken" value={`${result.gaps.length}`} valueColor={result.gaps.length > 0 ? '#E8A000' : C.green} sub={result.gaps.length > 0 ? 'Entscheidung nötig' : 'Vollständig besetzt'} />
            </StatStrip>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name','Rolle','Szenario','Schichten','Stunden','SFN §3b','Brutto','Netto','Besetzung','Aktionen'].map(h => (
                    <th key={h} style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 10.5, fontWeight: 600, color: C.ink3, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: ['Name','Rolle','Szenario','Besetzung','Aktionen'].includes(h) ? 'left' : 'right' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.schedules.map(sc => {
                  const emp = employees.find(e => e.id === sc.employeeId)!;
                  const net = calcMonthlyNet(sc.totalGross, sc.totalSFN, emp);
                  const hasGap = result.gaps.some(g => {
                    // simplistic: check if employee's role matches gap role
                    return g.role === emp.role;
                  });
                  return (
                    <tr key={sc.employeeId}>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 12, fontWeight: 600 }}>{emp.name}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px' }}>
                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: ROLE_BG[emp.role], color: ROLE_COLORS[emp.role] }}>
                          {ROLE_LABELS[emp.role]}
                        </span>
                      </td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 11.5, color: C.ink3 }}>
                        {scenario === 'conservative' ? 'Konservativ' : scenario === 'balanced' ? 'Ausgewogen' : 'Max SFN'}
                      </td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{sc.shifts.length}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{sc.totalH}h</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: C.orange }}>+{fmt(sc.totalSFN)}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{fmt(sc.totalGross)}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: C.green }}>{fmt(net.net)}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px' }}>
                        {hasGap && result.gaps.length > 0
                          ? <Badge variant="warn">⚠ Lücke</Badge>
                          : <Badge variant="ok">✓ OK</Badge>}
                      </td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px' }}>
                        <div style={{ display: 'flex', gap: 3 }}>
                          <Btn size="sm" variant="ghost">✏</Btn>
                          <Btn size="sm" variant="ghost">📄</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </Content>
    </div>
  );
}
