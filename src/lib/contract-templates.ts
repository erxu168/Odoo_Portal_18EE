// src/lib/contract-templates.ts
// Contract template engine — variable substitution + HTML → PDF pipeline
// Krawings Portal · krawings_rentals v1.1.0
//
// Templates are stored as HTML files (not .docx) to keep the pipeline simple
// and compatible with Puppeteer + DIN 5008 CSS. Upload a DOCX, convert once to
// HTML, store the HTML. We do NOT parse .docx at generation time.
//
// Variables use {{double_braces}} to distinguish from regular HTML.
// Supported types: string, number, date, currency.
//
// Fields JSON format (stored on contract_templates.fields_json):
// {
//   "fields": [
//     { "key": "tenant_name", "label": "Vollständiger Name", "type": "string", "required": true },
//     { "key": "kaltmiete", "label": "Kaltmiete", "type": "currency", "required": true },
//     ...
//   ]
// }

export interface TemplateField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'currency' | 'textarea';
  required: boolean;
  default_value?: string | number;
}

export interface TemplateFieldsSpec {
  fields: TemplateField[];
}

// ============================================================================
// Render template with variable substitution
// ============================================================================

export function renderTemplate(
  templateHtml: string,
  values: Record<string, string | number | null | undefined>
): string {
  return templateHtml.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    if (v === null || v === undefined) return '';
    return escapeHtml(String(v));
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Validate submitted form data against template fields
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  cleaned: Record<string, string | number>;
}

export function validateTemplateData(
  spec: TemplateFieldsSpec,
  data: Record<string, unknown>
): ValidationResult {
  const errors: Record<string, string> = {};
  const cleaned: Record<string, string | number> = {};

  for (const field of spec.fields) {
    const raw = data[field.key];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) errors[field.key] = `${field.label} ist erforderlich`;
      continue;
    }

    switch (field.type) {
      case 'string':
      case 'textarea':
        cleaned[field.key] = String(raw).trim();
        break;
      case 'number':
      case 'currency': {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
        if (isNaN(n)) {
          errors[field.key] = `${field.label} muss eine Zahl sein`;
        } else {
          cleaned[field.key] = field.type === 'currency' ? Math.round(n * 100) / 100 : n;
        }
        break;
      }
      case 'date': {
        const s = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          errors[field.key] = `${field.label} muss im Format JJJJ-MM-TT sein`;
        } else {
          cleaned[field.key] = s;
        }
        break;
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, cleaned };
}

// ============================================================================
// Format helpers for use in rendering (call before passing to renderTemplate)
// ============================================================================

export function formatForRender(
  spec: TemplateFieldsSpec,
  cleaned: Record<string, string | number>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = cleaned[f.key];
    if (v === undefined) { out[f.key] = ''; continue; }
    switch (f.type) {
      case 'currency':
        out[f.key] = formatCurrency(Number(v));
        break;
      case 'date':
        out[f.key] = formatDate(String(v));
        break;
      default:
        out[f.key] = String(v);
    }
  }
  return out;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ============================================================================
// DIN 5008 Form B wrapper — matches the existing termination module style
// ============================================================================

export function wrapDinA4(innerHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 25mm 20mm 25mm 25mm; }
body {
  font-family: 'Arial', 'Helvetica', sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #000;
}
h1 { font-size: 14pt; font-weight: bold; margin: 0 0 12pt; text-align: center; }
h2 { font-size: 12pt; font-weight: bold; margin: 18pt 0 6pt; }
h3 { font-size: 11pt; font-weight: bold; margin: 12pt 0 4pt; }
p { margin: 0 0 8pt; text-align: justify; }
table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
td { padding: 3pt 5pt; vertical-align: top; }
.sig-block { margin-top: 40pt; display: flex; justify-content: space-between; gap: 40pt; }
.sig-block div { flex: 1; border-top: 1px solid #000; padding-top: 4pt; font-size: 9pt; }
.small { font-size: 9pt; color: #555; }
</style>
</head>
<body>
${innerHtml}
</body>
</html>`;
}
