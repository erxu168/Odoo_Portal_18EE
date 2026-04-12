// src/lib/inspection-pdf.ts
// Render Übergabeprotokoll as DIN 5008 HTML for PDF generation
import { getRentalsDb } from '@/lib/rentals-db';
import { wrapDinA4 } from '@/lib/contract-templates';
import {
  Inspection, InspectionItem, MeterReading,
  Tenancy, Tenant, Room, Property, INSPECTION_FIXED_TEMPLATE,
} from '@/types/rentals';

const CONDITION_LABEL: Record<string, string> = {
  neuwertig: 'Neuwertig',
  gut: 'Gut',
  gebrauchsspuren: 'Gebrauchsspuren',
  beschaedigt: 'Beschädigt',
};

export async function renderInspectionPdf(inspectionId: number): Promise<string> {
  const db = getRentalsDb();

  const inspection = db.prepare(`SELECT * FROM inspections WHERE id = ?`).get(inspectionId) as Inspection;
  const items = db.prepare(`
    SELECT * FROM inspection_items WHERE inspection_id = ?
    ORDER BY category, item_order
  `).all(inspectionId) as InspectionItem[];
  const meters = db.prepare(`
    SELECT * FROM meter_readings WHERE inspection_id = ?
  `).all(inspectionId) as MeterReading[];

  const tenancy = db.prepare(`SELECT * FROM tenancies WHERE id = ?`).get(inspection.tenancy_id) as Tenancy;
  const tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenancy.tenant_id) as Tenant;
  const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(inspection.room_id) as Room;
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(inspection.property_id) as Property;

  const typeLabel = inspection.type === 'move_in' ? 'Einzugsprotokoll' : 'Auszugsprotokoll';
  const categoryLabels: Record<string, string> = {};
  for (const cat of INSPECTION_FIXED_TEMPLATE) {
    categoryLabels[cat.category] = cat.category_label_de;
  }

  // Group items by category
  const byCategory: Record<string, InspectionItem[]> = {};
  for (const i of items) {
    if (!byCategory[i.category]) byCategory[i.category] = [];
    byCategory[i.category].push(i);
  }

  const itemRows = Object.entries(byCategory).map(([cat, catItems]) => `
    <h3>${escapeHtml(categoryLabels[cat] || cat)}</h3>
    <table>
      <thead>
        <tr>
          <td style="font-weight:bold;width:45%">Element</td>
          <td style="font-weight:bold;width:20%">Zustand</td>
          <td style="font-weight:bold;width:35%">Anmerkungen</td>
        </tr>
      </thead>
      <tbody>
        ${catItems.map((i) => `
          <tr>
            <td>${escapeHtml(i.item_label)}</td>
            <td>${escapeHtml(i.condition ? CONDITION_LABEL[i.condition] : '—')}</td>
            <td>${escapeHtml(i.notes || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `).join('');

  const meterRows = meters.length > 0 ? `
    <h3>Zählerstände</h3>
    <table>
      <thead>
        <tr>
          <td style="font-weight:bold">Zähler</td>
          <td style="font-weight:bold">Nr.</td>
          <td style="font-weight:bold">Stand</td>
        </tr>
      </thead>
      <tbody>
        ${meters.map((m) => `
          <tr>
            <td>${escapeHtml(meterTypeLabel(m.meter_type))}</td>
            <td>${escapeHtml(m.meter_no)}</td>
            <td>${m.reading_value} ${escapeHtml(m.reading_unit)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const inner = `
    <h1>${typeLabel}</h1>
    <p style="text-align:center" class="small">
      Protokoll Nr. ${inspection.id} · ${formatDate(inspection.inspection_date)}
    </p>

    <h2>Mietobjekt</h2>
    <table>
      <tr><td style="width:30%">Adresse</td><td>${escapeHtml(property.street)}, ${escapeHtml(property.plz)} ${escapeHtml(property.city)}</td></tr>
      ${property.floor_unit ? `<tr><td>Lage</td><td>${escapeHtml(property.floor_unit)}</td></tr>` : ''}
      <tr><td>Zimmer</td><td>${escapeHtml(room.room_code)}${room.room_name ? ' — ' + escapeHtml(room.room_name) : ''} (${room.size_sqm} m²)</td></tr>
    </table>

    <h2>Beteiligte</h2>
    <table>
      <tr><td style="width:30%">Mieter</td><td>${escapeHtml(tenant.full_name)}</td></tr>
      <tr><td>Vermieter</td><td>${escapeHtml(property.owner || 'Krawings GmbH')}</td></tr>
      <tr><td>Inspektor</td><td>${escapeHtml(inspection.inspector_name)}</td></tr>
      <tr><td>Datum</td><td>${formatDate(inspection.inspection_date)}</td></tr>
    </table>

    ${meterRows}

    <h2>Zustandsprotokoll</h2>
    ${itemRows}

    ${inspection.notes ? `<h2>Allgemeine Anmerkungen</h2><p>${escapeHtml(inspection.notes)}</p>` : ''}

    <div class="sig-block">
      <div>Mieter / Mieterin<br><span class="small">${inspection.tenant_signed_at ? 'Unterzeichnet am ' + formatDate(inspection.tenant_signed_at.slice(0, 10)) : ''}</span></div>
      <div>Vermieter<br><span class="small">${inspection.landlord_signed_at ? 'Unterzeichnet am ' + formatDate(inspection.landlord_signed_at.slice(0, 10)) : ''}</span></div>
    </div>
  `;

  return wrapDinA4(inner, typeLabel);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function meterTypeLabel(t: string): string {
  return ({
    electricity: 'Strom',
    gas: 'Gas',
    water_cold: 'Wasser (kalt)',
    water_hot: 'Wasser (warm)',
    heating: 'Heizung',
  } as Record<string, string>)[t] || t;
}
