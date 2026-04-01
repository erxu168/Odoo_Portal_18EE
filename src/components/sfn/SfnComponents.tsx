'use client';
// ─────────────────────────────────────────────────────────────
// SfnIndividual.tsx
// ─────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  Employee, OpeningHours, StaffingWindow, StaffingReq,
  buildSingleSchedule, calcMonthlyNet, grossFromNet,
  fmt, ROLE_LABELS, SHIFT_TYPE_LABELS, MONTHS_DE, Scenario,
} from '@/lib/sfn-engine';
import {
  C, Card, CardHeader, Btn, Badge, Alert,
  StatStrip, StatBox, TopBar, Content, TwoCol, Divider,
  SectionTitle, FormGroup, inputStyle, selectStyle,
  MiniCalendar, PayrollBreakdown, ROLE_COLORS, ROLE_BG,
} from '@/components/sfn/sfn-ui';

interface IndividualProps {
  year: number; month: number;
  employees: Employee[];
  openingHours: OpeningHours[];
  staffingWindows: StaffingWindow[];
  staffingReqs: StaffingReq[][];
  holidays: Set<string>;
}

export function SfnIndividual({
  year, month, employees, openingHours, holidays,
}: IndividualProps) {
  const [empId, setEmpId] = useState<number | null>(null);
  const [scenario, setScenario] = useState<Scenario>('balanced');
  const [inputMode, setInputMode] = useState<'brutto' | 'netto' | 'stunden'>('brutto');
  const [targetBrutto, setTargetBrutto] = useState('2400');
  const [targetNetto, setTargetNetto] = useState('1800');
  const [targetStunden, setTargetStunden] = useState('160');
  const [result, setResult] = useState<ReturnType<typeof buildSingleSchedule> | null>(null);

  const emp = employees.find(e => e.id === empId);
  const monthLabel = MONTHS_DE[month - 1];

  function getTargetGross(): number {
    if (!emp) return 2400;
    if (inputMode === 'brutto') return parseFloat(targetBrutto) || emp.target_brutto;
    if (inputMode === 'netto') return grossFromNet(parseFloat(targetNetto) || 1800, 0.08, emp);
    return (parseFloat(targetStunden) || 160) * emp.grundlohn;
  }

  function generate() {
    if (!emp) return;
    const gross = getTargetGross();
    const shifts = buildSingleSchedule(year, month, emp, gross, scenario, openingHours, holidays);
    setResult(shifts);
  }

  const totalSFN   = result?.reduce((s, sh) => s + sh.sfnLst, 0) ?? 0;
  const totalGross = result?.reduce((s, sh) => s + sh.grossPay, 0) ?? 0;
  const totalBase  = result?.reduce((s, sh) => s + sh.basePay, 0) ?? 0;
  const totalH     = result?.reduce((s, sh) => s + sh.lengthH, 0) ?? 0;
  const net        = emp && result ? calcMonthlyNet(totalGross, totalSFN, emp) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <TopBar title="Einzeln anpassen" sub={`Schichtplan für einen Mitarbeiter · ${monthLabel} ${year}`} />
      <Content>
        <TwoCol>
          {/* Input */}
          <Card>
            <CardHeader title="1 · Mitarbeiter & Eingabe" />
            <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              <FormGroup label="Mitarbeiter/in">
                <select style={selectStyle} value={empId ?? ''} onChange={e => { setEmpId(parseInt(e.target.value) || null); setResult(null); }}>
                  <option value="">— Auswählen —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name} · {ROLE_LABELS[e.role]}</option>
                  ))}
                </select>
              </FormGroup>
              <FormGroup label="Szenario">
                <select style={selectStyle} value={scenario} onChange={e => setScenario(e.target.value as Scenario)}>
                  <option value="conservative">🛡 Konservativ</option>
                  <option value="balanced">⚖️ Ausgewogen</option>
                  <option value="max">🚀 Maximum SFN</option>
                </select>
              </FormGroup>
            </div>

            {emp && (
              <>
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, fontSize: 12, marginBottom: 12 }}>
                  <SectionTitle>Aus Odoo 18 EE geladen</SectionTitle>
                  {[
                    ['Grundlohn', `${emp.grundlohn.toFixed(2)} €/h`],
                    ['Rolle', ROLE_LABELS[emp.role] + (emp.flex ? ' · flexibel' : '')],
                    ['Steuerklasse', `Stkl. ${emp.stkl}`],
                    ['KV', `GKV · ${emp.kv_zusatz}% Zusatz`],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, borderBottom: `1px solid rgba(0,0,0,.05)` }}>
                      <span style={{ color: C.ink3 }}>{l}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                  {emp.grundlohn > 25 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#7A5800', background: C.yellowL, padding: '4px 7px', borderRadius: 4 }}>
                      △ GL &gt; 25 €/h: Zuschläge nur lohnsteuerfrei, nicht SV-frei
                    </div>
                  )}
                </div>

                <FormGroup label="Berechnungsmodus" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 7 }}>
                    {[['brutto','Bruttolohn'],['netto','Nettolohn'],['stunden','Std × GL']].map(([id, label]) => (
                      <div key={id} onClick={() => setInputMode(id as typeof inputMode)} style={{
                        flex: 1, padding: '6px 8px', borderRadius: 5, textAlign: 'center', cursor: 'pointer', fontSize: 11.5,
                        border: `1.5px solid ${inputMode === id ? C.orange : C.border2}`,
                        background: inputMode === id ? C.orangeL : C.card,
                        color: inputMode === id ? C.orangeDim : C.ink2,
                        fontWeight: inputMode === id ? 600 : 400,
                      }}>{label}</div>
                    ))}
                  </div>
                </FormGroup>

                {inputMode === 'brutto' && (
                  <FormGroup label="Ziel-Bruttolohn (€/Monat)" hint="Scheduler bleibt unter diesem Betrag">
                    <input type="number" style={inputStyle} value={targetBrutto} onChange={e => setTargetBrutto(e.target.value)} />
                  </FormGroup>
                )}
                {inputMode === 'netto' && (
                  <FormGroup label="Ziel-Nettolohn (€/Monat)" hint="System berechnet benötigtes Brutto rückwärts">
                    <input type="number" style={inputStyle} value={targetNetto} onChange={e => setTargetNetto(e.target.value)} />
                    <div style={{ fontSize: 11, background: C.orangeL, border: `1px solid ${C.orange}`, borderRadius: 4, padding: '4px 8px', marginTop: 4 }}>
                      Benötigtes Brutto: <strong style={{ fontFamily: 'monospace' }}>~{fmt(grossFromNet(parseFloat(targetNetto) || 1800, 0.08, emp))}</strong>
                    </div>
                  </FormGroup>
                )}
                {inputMode === 'stunden' && (
                  <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                    <FormGroup label="Stunden/Monat">
                      <input type="number" style={inputStyle} value={targetStunden} onChange={e => setTargetStunden(e.target.value)} />
                    </FormGroup>
                    <FormGroup label="Berechnet (Brutto)">
                      <input type="text" style={{ ...inputStyle, background: C.bg }} readOnly value={fmt((parseFloat(targetStunden)||160) * emp.grundlohn)} />
                    </FormGroup>
                  </div>
                )}

                <Btn variant="primary" style={{ width: '100%', marginTop: 8, justifyContent: 'center' }} onClick={generate}>
                  ⚡ Schichtplan generieren
                </Btn>
              </>
            )}
          </Card>

          {/* Result */}
          {result && emp && net ? (
            <Card>
              <CardHeader title={`${emp.name} · ${monthLabel} ${year}`}>
                <Btn size="sm" variant="ghost">🖨 Nachweis</Btn>
                <Btn size="sm" variant="success">✓ Bestätigen</Btn>
              </CardHeader>

              <StatStrip cols={3}>
                <StatBox label="Schichten" value={`${result.length}`} />
                <StatBox label="SFN §3b" value={fmt(totalSFN)} valueColor={C.orange} />
                <StatBox label="Netto" value={fmt(net.net)} valueColor={C.green} />
              </StatStrip>

              <Alert variant="ok" style={{ marginBottom: 12 }}>
                ✅ ArbZG eingehalten · max 10h/Schicht · 40h/Woche · 11h Ruhezeit
              </Alert>

              <SectionTitle>Kalender · {monthLabel} {year}</SectionTitle>
              <MiniCalendar shifts={result} year={year} month={month} role={emp.role} />

              <Divider />
              <SectionTitle>Schicht-Details</SectionTitle>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      {['Datum','Art','Arbeitszeit','Std','Grundlohn','SFN §3b','Brutto'].map(h => (
                        <th key={h} style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '5px 8px', fontSize: 10, fontWeight: 600, color: C.ink3, textTransform: 'uppercase', textAlign: ['Std','Grundlohn','SFN §3b','Brutto'].includes(h) ? 'right' : 'left' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.map((s, i) => (
                      <tr key={i}>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                          {String(s.day).padStart(2,'0')}.{String(month).padStart(2,'0')}.{year}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px' }}>
                          <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: { normal: C.bg, night: '#EEF0FF', sunday: C.yellowL, holiday: C.redL }[s.type], color: { normal: C.ink3, night: '#3B4AC0', sunday: '#7A5800', holiday: C.red }[s.type] }}>
                            {SHIFT_TYPE_LABELS[s.type]}
                          </span>
                          {s.passOne && <span style={{ marginLeft: 3, fontSize: 9, color: C.ink3 }}>P1</span>}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                          {String(s.startH).padStart(2,'0')}:00 – {String(s.endH % 24).padStart(2,'0')}:00{s.endH >= 24 ? ' +1' : ''}
                        </td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{s.lengthH}h</td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.basePay)}</td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", color: C.orange }}>{s.sfnLst > 0 ? '+' + fmt(s.sfnLst) : '—'}</td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.grossPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Divider />
              <SectionTitle>Gehaltsberechnung</SectionTitle>
              <PayrollBreakdown gross={totalGross} sfn={totalSFN} base={totalBase} net={net} />
            </Card>
          ) : (
            <Card style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, background: C.bg }}>
              <div style={{ textAlign: 'center', color: C.ink3 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                <div style={{ fontSize: 13 }}>Mitarbeiter auswählen und Plan generieren</div>
              </div>
            </Card>
          )}
        </TwoCol>
      </Content>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SfnSimulator.tsx
// ─────────────────────────────────────────────────────────────
import { runSimulation } from '@/lib/sfn-engine';

interface SimProps {
  year: number; month: number;
  employees: Employee[];
  openingHours: OpeningHours[];
  holidays: Set<string>;
}

export function SfnSimulator({ year, month, employees, openingHours, holidays }: SimProps) {
  const [empId, setEmpId] = useState<number>(employees[0]?.id ?? 1);
  const [fixedGross, setFixedGross] = useState('2400');
  const emp = employees.find(e => e.id === empId) ?? employees[0];

  const sim = emp ? runSimulation(
    parseFloat(fixedGross) || 2400, emp,
    year, month, openingHours, holidays, 'balanced'
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <TopBar title="Was-wäre-wenn Simulator" sub="§3b EStG Optimierungsanalyse · Gleicher Bruttolohn — anderer Split" />
      <Content>
        <TwoCol>
          <Card>
            <CardHeader title="Eingabe" />
            <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              <FormGroup label="Mitarbeiter/in">
                <select style={selectStyle} value={empId} onChange={e => setEmpId(parseInt(e.target.value))}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </FormGroup>
              <FormGroup label="Fixiertes Brutto (€)">
                <input type="number" style={inputStyle} value={fixedGross} onChange={e => setFixedGross(e.target.value)} />
              </FormGroup>
            </div>
            <Alert variant="info">
              ℹ️ <div>
                <strong>Gleicher Bruttolohn — anderer Split.</strong><br />
                <strong>Aktuell</strong> = alles Grundlohn. SFN = 0. Volle LSt auf alles.<br />
                <strong>Fiktiv</strong> = selbes Brutto, aufgeteilt in Grundlohn + SFN §3b (lohnsteuerfrei). Differenz = reiner Steuervorteil.
              </div>
            </Alert>
            {emp && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px solid rgba(0,0,0,.05)` }}>
                  <span style={{ color: C.ink3 }}>Grundlohn</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{emp.grundlohn.toFixed(2)} €/h</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: C.ink3 }}>Steuerklasse</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>Stkl. {emp.stkl}</span>
                </div>
                {emp.grundlohn <= 25 && <div style={{ marginTop: 6, fontSize: 11, color: C.green, background: C.greenL, padding: '4px 7px', borderRadius: 4 }}>✓ GL ≤ 25 €/h: Zuschläge lohnsteuer- und SV-frei</div>}
                {emp.grundlohn > 25 && emp.grundlohn <= 50 && <div style={{ marginTop: 6, fontSize: 11, color: '#7A5800', background: C.yellowL, padding: '4px 7px', borderRadius: 4 }}>△ 25–50 €/h: nur lohnsteuerfrei, nicht SV-frei</div>}
              </div>
            )}
          </Card>

          {sim && (
            <Card>
              <CardHeader title={`Ergebnis · ${emp?.name}`} />
              <div style={{ background: sim.diffNet >= 0 ? C.greenL : C.redL, border: `2px solid ${sim.diffNet >= 0 ? C.green : C.red}`, borderRadius: 7, padding: 14, textAlign: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: sim.diffNet >= 0 ? C.green : C.red, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {sim.diffNet >= 0 ? '+' : ''}{fmt(sim.diffNet)}
                </div>
                <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>
                  {sim.diffNet >= 0 ? '+' : ''}{sim.diffPct.toFixed(1)}% mehr Netto · bei gleichem Bruttolohn
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'start' }}>
                {/* Aktuell */}
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: C.ink3, marginBottom: 10 }}>Aktuell (kein SFN)</div>
                  {[
                    ['Brutto', fmt(parseFloat(fixedGross) || 2400), undefined],
                    ['SFN §3b', '0,00\u00a0€', undefined],
                    ['− SV (AN)', '−' + fmt(sim.actualNet.sv), C.red],
                    ['− Lohnsteuer', '−' + fmt(sim.actualNet.lst), C.red],
                    ['− Soli', sim.actualNet.soli > 0.01 ? '−' + fmt(sim.actualNet.soli) : '0,00\u00a0€', sim.actualNet.soli > 0.01 ? C.red : C.ink3],
                  ].map(([l, v, c]) => (
                    <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid rgba(0,0,0,.05)`, fontSize: 12 }}>
                      <span style={{ color: C.ink3 }}>{l}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: (c as string | undefined) || C.ink }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 0', fontSize: 13, fontWeight: 700, borderTop: `2px solid ${C.border}`, marginTop: 4 }}>
                    <span>= NETTO</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(sim.actualNet.net)}</span>
                  </div>
                </div>

                <div style={{ fontSize: 16, fontWeight: 700, color: C.ink3, alignSelf: 'center' }}>VS</div>

                {/* Fiktiv */}
                <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 7, padding: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: C.green, marginBottom: 10 }}>Fiktiv (mit SFN)</div>
                  {[
                    ['Brutto', fmt(parseFloat(fixedGross) || 2400), undefined],
                    ['SFN §3b', '+' + fmt(sim.fictionalSFN), C.orange],
                    ['− SV (AN)', '−' + fmt(sim.fictionalNet.sv), C.red],
                    ['− Lohnsteuer', '−' + fmt(sim.fictionalNet.lst), C.red],
                    ['− Soli', sim.fictionalNet.soli > 0.01 ? '−' + fmt(sim.fictionalNet.soli) : '0,00\u00a0€', sim.fictionalNet.soli > 0.01 ? C.red : C.ink3],
                  ].map(([l, v, c]) => (
                    <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid rgba(0,0,0,.05)`, fontSize: 12 }}>
                      <span style={{ color: C.ink3 }}>{l}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: (c as string | undefined) || C.ink }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 0', fontSize: 13, fontWeight: 700, borderTop: `2px solid ${C.green}`, marginTop: 4 }}>
                    <span>= NETTO</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.green }}>{fmt(sim.fictionalNet.net)}</span>
                  </div>
                </div>
              </div>

              <Divider />
              <div style={{ fontSize: 12, lineHeight: 1.8, color: C.ink2 }}>
                <strong>Interpretation:</strong> Bei fixiertem Brutto von {fmt(parseFloat(fixedGross)||2400)} bringt SFN-Optimierung
                {' '}<strong style={{ color: C.green }}>{sim.diffNet >= 0 ? '+' : ''}{fmt(sim.diffNet)}/Monat</strong>.
                SFN-Anteil am Brutto: <strong style={{ color: C.orange }}>{sim.sfnPctOfGross.toFixed(1)}%</strong>.
              </div>
            </Card>
          )}
        </TwoCol>
      </Content>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SfnSettings.tsx
// ─────────────────────────────────────────────────────────────

interface SettingsProps {
  openingHours: OpeningHours[];
  staffingWindows: StaffingWindow[];
  staffingReqs: StaffingReq[][];
  employees: Employee[];
  onSaveHours: (h: OpeningHours[]) => void;
  onSaveStaffing: (w: StaffingWindow[], r: StaffingReq[][]) => void;
  onSaveEmployees: (e: Employee[]) => void;
}

export function SfnSettings({
  openingHours, staffingWindows, staffingReqs, employees,
  onSaveHours, onSaveStaffing, onSaveEmployees,
}: SettingsProps) {
  const [tab, setTab] = useState<'hours' | 'staffing' | 'employees' | 'arbzg'>('hours');
  const [localHours, setLocalHours] = useState<OpeningHours[]>(openingHours);
  const [localReqs, setLocalReqs] = useState<StaffingReq[][]>(staffingReqs);
  const [localEmps, setLocalEmps] = useState<Employee[]>(employees);
  const [saved, setSaved] = useState(false);

  function save() {
    onSaveHours(localHours);
    onSaveStaffing(staffingWindows, localReqs);
    onSaveEmployees(localEmps);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const dayTypeLabels = ['Mo–Do', 'Freitag', 'Samstag', 'Sonntag'];
  const dayTypeIdx    = [0, 1, 1, 2]; // for display only

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <TopBar title="Einstellungen" sub="Öffnungszeiten · Besetzungsplan · Mitarbeiter · ArbZG">
        <Btn variant={saved ? 'success' : 'primary'} onClick={save}>{saved ? '✓ Gespeichert' : 'Speichern'}</Btn>
      </TopBar>
      <Content>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `2px solid ${C.border}`, marginBottom: 18 }}>
          {[
            { id: 'hours' as const, label: '🕐 Öffnungszeiten' },
            { id: 'staffing' as const, label: '📋 Besetzungsplan' },
            { id: 'employees' as const, label: '🧑‍💼 Mitarbeiter' },
            { id: 'arbzg' as const, label: '⚖️ ArbZG & Grenzen' },
          ].map(t => (
            <div key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '9px 16px', fontSize: 12, fontWeight: tab === t.id ? 600 : 500,
              color: tab === t.id ? C.orange : C.ink3,
              borderBottom: `2px solid ${tab === t.id ? C.orange : 'transparent'}`,
              marginBottom: -2, cursor: 'pointer',
            }}>{t.label}</div>
          ))}
        </div>

        {/* OPENING HOURS */}
        {tab === 'hours' && (
          <TwoCol>
            <Card>
              <CardHeader title="Öffnungszeiten · Krawings SSAM Berlin" />
              <Alert variant="info" style={{ marginBottom: 14 }}>
                ℹ️ Stunden &gt;24 = nächster Tag (26 = 02:00 Uhr). Scheduler plant keine Schichten außerhalb dieser Fenster.
              </Alert>
              {localHours.map((dh, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ width: 90, fontSize: 12.5, fontWeight: 600 }}>{dh.day}</div>
                  <div
                    onClick={() => { const h = [...localHours]; h[i] = { ...h[i], open: !h[i].open }; setLocalHours(h); }}
                    style={{ width: 36, height: 20, background: dh.open ? C.orange : C.border2, borderRadius: 10, cursor: 'pointer', position: 'relative', flexShrink: 0 }}
                  >
                    <div style={{ position: 'absolute', width: 16, height: 16, borderRadius: '50%', background: '#fff', top: 2, left: dh.open ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                  </div>
                  {dh.open ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="number" value={dh.startH} min={0} max={23} style={{ ...inputStyle, width: 50, textAlign: 'center', fontFamily: 'monospace' }}
                        onChange={e => { const h = [...localHours]; h[i] = { ...h[i], startH: parseInt(e.target.value)||0 }; setLocalHours(h); }} />
                      <span>Uhr –</span>
                      <input type="number" value={dh.endH} min={1} max={30} style={{ ...inputStyle, width: 50, textAlign: 'center', fontFamily: 'monospace' }}
                        onChange={e => { const h = [...localHours]; h[i] = { ...h[i], endH: parseInt(e.target.value)||24 }; setLocalHours(h); }} />
                      <span>Uhr</span>
                      {dh.endH > 24 && <span style={{ fontSize: 10.5, color: C.ink3 }}>+1 Tag, {String(dh.endH-24).padStart(2,'0')}:00</span>}
                      {(dh.endH >= 20 || dh.startH < 6) && <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9.5, background: '#EEF0FF', color: '#3B4AC0', fontWeight: 600 }}>§3b Nacht</span>}
                    </div>
                  ) : <span style={{ fontSize: 12, color: C.ink3 }}>Geschlossen</span>}
                </div>
              ))}
            </Card>
            <Card>
              <CardHeader title="Vorschau · §3b-Stunden pro Tag" />
              {localHours.map((dh, i) => {
                if (!dh.open) return <div key={i} style={{ fontSize: 12, color: C.ink3, padding: '3px 0' }}>❌ {dh.day}: Geschlossen</div>;
                const sfnH = Math.max(0, Math.min(dh.endH, 28) - 20) + (dh.startH < 6 ? Math.min(6, dh.startH) : 0);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
                    <span style={{ width: 90, fontWeight: 600 }}>{dh.day}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{String(dh.startH).padStart(2,'0')}:00 – {String(dh.endH%24).padStart(2,'0')}:00{dh.endH>=24?' (+1)':''}</span>
                    {sfnH > 0 && <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9.5, background: '#EEF0FF', color: '#3B4AC0', fontWeight: 600 }}>{sfnH}h §3b</span>}
                  </div>
                );
              })}
            </Card>
          </TwoCol>
        )}

        {/* STAFFING TEMPLATE */}
        {tab === 'staffing' && (
          <Card>
            <CardHeader title="Besetzungsplan · Mindestbesetzung pro Zeitfenster & Wochentag" />
            <Alert variant="info" style={{ marginBottom: 14 }}>
              ℹ️ <div><strong>Phase 1</strong> des Schedulers füllt diese Pflichtslots zuerst, bevor Phase 2 für SFN optimiert. 🍳=Küche, 🍽=Service, 🍸=Bar, 0=keine Mindestanforderung.</div>
            </Alert>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={{ background: C.ink, color: '#fff', padding: '6px 10px', textAlign: 'left', fontSize: 11, borderRadius: '5px 0 0 0' }}>Zeitfenster</th>
                    <th style={{ background: C.ink, color: '#fff', padding: '6px 10px', fontSize: 11 }}>Zeit</th>
                    {['Mo–Do','Freitag','Samstag','Sonntag'].map((d, i) => (
                      <th key={d} colSpan={3} style={{ background: C.ink, color: '#fff', padding: '6px 10px', textAlign: 'center', fontSize: 11 }}>{d}</th>
                    ))}
                  </tr>
                  <tr>
                    <th colSpan={2} style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '5px 8px' }}></th>
                    {[0,1,2,3].map(di => (
                      <React.Fragment key={di}>
                        <th style={{ background: C.kitchenL, color: C.kitchen, border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'center', fontSize: 10 }}>🍳</th>
                        <th style={{ background: C.serviceL, color: C.service, border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'center', fontSize: 10 }}>🍽</th>
                        <th style={{ background: C.barL,     color: C.bar,     border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'center', fontSize: 10 }}>🍸</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffingWindows.map((win, wi) => {
                    const dtIdx = [0, 1, 1, 2]; // Mo-Do=0, Fr=1, Sa=1, Su=2
                    return (
                      <tr key={wi}>
                        <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px', fontWeight: 600 }}>{win.name}</td>
                        <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                          {String(win.startH).padStart(2,'0')}:00–{String(win.endH%24).padStart(2,'0')}:00{win.endH>=24?' +1':''}
                        </td>
                        {[0,1,2,3].map(di => {
                          const dt = dtIdx[di];
                          const req = localReqs[wi]?.[dt] || { kitchen:0, service:0, bar:0 };
                          return (['kitchen','service','bar'] as const).map(role => (
                            <td key={role} style={{ border: `1px solid ${C.border}`, padding: '5px', textAlign: 'center' }}>
                              <input
                                type="number" min={0} max={9} value={req[role]}
                                style={{ width: 36, padding: '3px 4px', border: `1px solid ${C.border2}`, borderRadius: 3, fontSize: 12, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}
                                onChange={e => {
                                  const r = localReqs.map((row, rowi) => rowi !== wi ? row : row.map((cell, ci) => ci !== dt ? cell : { ...cell, [role]: parseInt(e.target.value)||0 }));
                                  setLocalReqs(r);
                                }}
                              />
                            </td>
                          ));
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* EMPLOYEES */}
        {tab === 'employees' && (
          <Card>
            <CardHeader title="Mitarbeiter · Rollen & Flexibilität">
              <span style={{ fontSize: 11.5, color: C.ink3 }}>Daten aus Odoo 18 EE · hr.employee</span>
            </CardHeader>
            <Alert variant="info" style={{ marginBottom: 12 }}>
              ℹ️ <div>Grundlohn, Steuerklasse und SV-Daten werden automatisch aus Odoo geladen. Hier konfigurieren Sie nur SFN-spezifische Einstellungen: Rolle und Flexibilität.</div>
            </Alert>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name','Primäre Rolle','Flexibel','GL €/h','Stkl.','KV','Ziel Brutto'].map(h => (
                    <th key={h} style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 10.5, fontWeight: 600, color: C.ink3, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: h === 'Name' ? 'left' : 'center' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {localEmps.map((emp, i) => (
                  <tr key={emp.id}>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', fontSize: 12, fontWeight: 600 }}>{emp.name}</td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'center' }}>
                      <select
                        value={emp.role}
                        style={{ ...selectStyle, padding: '3px 6px', fontSize: 11.5 }}
                        onChange={e => { const emps = [...localEmps]; emps[i] = { ...emps[i], role: e.target.value as Role }; setLocalEmps(emps); }}
                      >
                        <option value="kitchen">🍳 Küche</option>
                        <option value="service">🍽 Service</option>
                        <option value="bar">🍸 Bar</option>
                      </select>
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={emp.flex} style={{ cursor: 'pointer', width: 15, height: 15 }}
                        onChange={e => { const emps = [...localEmps]; emps[i] = { ...emps[i], flex: e.target.checked }; setLocalEmps(emps); }} />
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                      {emp.grundlohn.toFixed(2)}
                    </td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'center', fontSize: 12 }}>Stkl. {emp.stkl}</td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'center', fontSize: 11.5, color: C.ink3 }}>GKV</td>
                    <td style={{ border: `1px solid ${C.border}`, padding: '7px 8px', textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                      <input type="number" value={emp.target_brutto} style={{ ...inputStyle, width: 80, textAlign: 'right', padding: '3px 6px' }}
                        onChange={e => { const emps = [...localEmps]; emps[i] = { ...emps[i], target_brutto: parseFloat(e.target.value)||0 }; setLocalEmps(emps); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* ARBZG */}
        {tab === 'arbzg' && (
          <TwoCol>
            <Card>
              <CardHeader title="ArbZG Grenzwerte" />
              <Alert variant="warn" style={{ marginBottom: 12 }}>
                ⚠️ Diese Grenzen werden vom Scheduler <strong>hart erzwungen</strong>. Keine Schicht überschreitet diese Limits.
              </Alert>
              {[
                ['Max. Schichtlänge (Stunden)', 10, '§3 ArbZG: Maximum 10 Stunden/Schicht'],
                ['Min. Schichtlänge (Stunden)', 4, 'Krawings-Standard: Minimum 4 Stunden'],
                ['Max. Wochenarbeitsstunden', 40, '§3 ArbZG: Maximum 48h, Standard 40h'],
                ['Min. Ruhezeit zwischen Schichten (h)', 11, '§5 ArbZG: Minimum 11 Stunden'],
                ['Min. Ruhetage pro Woche', 2, '§9 ArbZG: Sonntag als Ruhetag (Gastro-Ausnahmen)'],
              ].map(([label, val, hint]) => (
                <FormGroup key={label as string} label={label as string} hint={hint as string} style={{ marginBottom: 12 }}>
                  <input type="number" defaultValue={val as number} style={inputStyle} />
                </FormGroup>
              ))}
            </Card>
            <Card>
              <CardHeader title="Berliner Feiertage 2026" />
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr>
                  <th style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, color: C.ink3, textTransform: 'uppercase' }}>Datum</th>
                  <th style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, color: C.ink3, textTransform: 'uppercase' }}>Feiertag</th>
                  <th style={{ background: C.bg, border: `1px solid ${C.border}`, padding: '6px 8px', textAlign: 'right', fontSize: 10.5, fontWeight: 600, color: C.ink3, textTransform: 'uppercase' }}>Zuschlag</th>
                </tr></thead>
                <tbody>
                  {[
                    ['01.01.', 'Neujahr', '+125%'],
                    ['03.04.', 'Karfreitag', '+125%'],
                    ['05.04.', 'Ostersonntag', '+125%'],
                    ['06.04.', 'Ostermontag', '+125%'],
                    ['01.05.', 'Tag der Arbeit', '+150%'],
                    ['14.05.', 'Christi Himmelfahrt', '+125%'],
                    ['24.05.', 'Pfingstsonntag', '+125%'],
                    ['25.05.', 'Pfingstmontag', '+125%'],
                    ['03.10.', 'Tag der deutschen Einheit', '+125%'],
                    ['25.12.', '1. Weihnachtstag', '+150%'],
                    ['26.12.', '2. Weihnachtstag', '+150%'],
                  ].map(([date, name, rate]) => (
                    <tr key={date}>
                      <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', fontFamily: "'IBM Plex Mono', monospace" }}>{date}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px' }}>{name}</td>
                      <td style={{ border: `1px solid ${C.border}`, padding: '5px 8px', textAlign: 'right' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: rate === '+150%' ? '#FFD6D6' : C.redL, color: C.red }}>{rate}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 11, color: C.ink3 }}>Heiligabend & Silvester ab 14:00 Uhr: +125% · Hardcoded für Berlin</div>
            </Card>
          </TwoCol>
        )}
      </Content>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Default exports for each component
// ─────────────────────────────────────────────────────────────
export default SfnIndividual;
