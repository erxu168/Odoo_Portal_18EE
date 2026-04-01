'use client';

import { useState } from 'react';
import SfnDashboard from '@/components/sfn/SfnDashboard';
import SfnBatchGenerate from '@/components/sfn/SfnBatchGenerate';
import SfnIndividual from '@/components/sfn/SfnIndividual';
import SfnSimulator from '@/components/sfn/SfnSimulator';
import SfnSettings from '@/components/sfn/SfnSettings';
import SfnSidebar from '@/components/sfn/SfnSidebar';
import {
  DEFAULT_OPENING_HOURS,
  DEFAULT_STAFFING_WINDOWS,
  DEFAULT_STAFFING_REQS,
  getBerlinHolidays,
  OpeningHours,
  StaffingWindow,
  StaffingReq,
  Employee,
} from '@/lib/sfn-engine';

export type SfnTab = 'dashboard' | 'batch' | 'individual' | 'simulator' | 'settings';

// ── DEMO EMPLOYEES (replaced by Odoo API later) ───────────────
const DEMO_EMPLOYEES: Employee[] = [
  { id:1, name:'Anna Müller',   grundlohn:15.00, stkl:1, kfb:0,   kv:'gkv', kv_zusatz:2.9, pv_kinder:false, rv:true, role:'kitchen', flex:false, target_brutto:2400 },
  { id:2, name:'Tom Schmidt',   grundlohn:15.50, stkl:3, kfb:2.0, kv:'gkv', kv_zusatz:2.9, pv_kinder:true,  rv:true, role:'service', flex:false, target_brutto:2500 },
  { id:3, name:'Sara Yılmaz',   grundlohn:14.50, stkl:1, kfb:0,   kv:'gkv', kv_zusatz:2.9, pv_kinder:false, rv:true, role:'bar',     flex:false, target_brutto:1800 },
  { id:4, name:'Kai Weber',     grundlohn:13.50, stkl:1, kfb:0,   kv:'gkv', kv_zusatz:2.9, pv_kinder:false, rv:true, role:'kitchen', flex:true,  target_brutto:550  },
  { id:5, name:'Lena Fischer',  grundlohn:15.00, stkl:1, kfb:0,   kv:'gkv', kv_zusatz:2.9, pv_kinder:false, rv:true, role:'service', flex:true,  target_brutto:2300 },
  { id:6, name:'Max Braun',     grundlohn:15.00, stkl:1, kfb:0,   kv:'gkv', kv_zusatz:2.9, pv_kinder:false, rv:true, role:'kitchen', flex:false, target_brutto:2400 },
  { id:7, name:'Julia Krause',  grundlohn:15.00, stkl:2, kfb:1.0, kv:'gkv', kv_zusatz:2.9, pv_kinder:true,  rv:true, role:'service', flex:false, target_brutto:2100 },
  { id:8, name:'David Bauer',   grundlohn:15.00, stkl:1, kfb:0,   kv:'gkv', kv_zusatz:2.9, pv_kinder:false, rv:true, role:'bar',     flex:true,  target_brutto:2200 },
];

export default function SfnPage() {
  const [tab, setTab] = useState<SfnTab>('dashboard');
  const [year]  = useState(2026);
  const [month] = useState(3); // März
  const [employees, setEmployees] = useState<Employee[]>(DEMO_EMPLOYEES);
  const [openingHours, setOpeningHours] = useState<OpeningHours[]>(DEFAULT_OPENING_HOURS);
  const [staffingWindows, setStaffingWindows] = useState<StaffingWindow[]>(DEFAULT_STAFFING_WINDOWS);
  const [staffingReqs, setStaffingReqs] = useState<StaffingReq[][]>(DEFAULT_STAFFING_REQS);
  const holidays = getBerlinHolidays(year);

  const shared = { year, month, employees, openingHours, staffingWindows, staffingReqs, holidays };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <SfnSidebar activeTab={tab} onTabChange={setTab} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'dashboard'  && <SfnDashboard  {...shared} onTabChange={setTab} />}
        {tab === 'batch'      && <SfnBatchGenerate {...shared} />}
        {tab === 'individual' && <SfnIndividual {...shared} />}
        {tab === 'simulator'  && <SfnSimulator  {...shared} />}
        {tab === 'settings'   && (
          <SfnSettings
            openingHours={openingHours}
            staffingWindows={staffingWindows}
            staffingReqs={staffingReqs}
            employees={employees}
            onSaveHours={setOpeningHours}
            onSaveStaffing={(w, r) => { setStaffingWindows(w); setStaffingReqs(r); }}
            onSaveEmployees={setEmployees}
          />
        )}
      </div>
    </div>
  );
}
