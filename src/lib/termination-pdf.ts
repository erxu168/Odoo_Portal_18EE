/**
 * Termination letter PDF generator — DIN 5008 compliant layout.
 * Builds HTML → calls wkhtmltopdf on the server → returns PDF buffer.
 * Native UTF-8 support — no encoding issues.
 *
 * DIN 5008 Form B key measurements:
 * - Page: A4 (210mm x 297mm)
 * - Left margin: 25mm
 * - Right margin: 20mm
 * - Address zone: 45mm from top, 80mm wide, sender return line + recipient
 * - Info block (date/ref): right column, aligned with address zone top
 * - Subject: ~3.4mm below address zone (approx 98mm from top)
 * - Body: starts below subject
 * - Folding marks: 87mm and 192mm from top
 */
import { exec } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const WKHTMLTOPDF = '/usr/local/bin/wkhtmltopdf';

interface LetterData {
  companyName: string;
  companyStreet: string;
  companyZip: string;
  companyCity: string;
  companyPhone: string;
  companyEmail: string;
  companyVat: string;
  companyLogoBase64: string | null;
  employeeName: string;
  employeeStreet: string;
  employeeZip: string;
  employeeCity: string;
  employeeGender: 'male' | 'female' | 'other';
  letterDate: string;
  recordId: number;
  lastWorkingDay: string;
  noticePeriodText: string;
  terminationType: string;
  employeeStartDate?: string;
  includeSeverance?: boolean;
  severanceAmount?: number;
  gardenLeave?: boolean;
  resignationReceivedDate?: string;
}

function salutation(gender: string, name: string): string {
  const last = name.trim().split(/\s+/).pop() || name;
  if (gender === 'male') return `Sehr geehrter Herr ${last},`;
  if (gender === 'female') return `Sehr geehrte Frau ${last},`;
  return `Sehr geehrte/r Herr/Frau ${last},`;
}

/**
 * Build the full HTML page wrapper with DIN 5008 Form B positioning.
 * The header area is absolutely positioned so it lines up with envelope windows.
 */
function wrapPage(d: LetterData, infoRows: string, bodyContent: string): string {
  const logo = d.companyLogoBase64
    ? `<img src="${d.companyLogoBase64}" style="max-height:15mm;max-width:45mm;display:block;margin-bottom:2mm" alt="Logo"/>`
    : '';

  return `
    <!-- Folding marks -->
    <div style="position:fixed;left:5mm;top:87mm;width:4mm;border-top:0.5px solid #ccc"></div>
    <div style="position:fixed;left:5mm;top:192mm;width:4mm;border-top:0.5px solid #ccc"></div>
    <!-- Punch mark -->
    <div style="position:fixed;left:5mm;top:148.5mm;width:3mm;border-top:0.5px solid #ccc"></div>

    <!-- === HEADER AREA (absolute positioned) === -->
    <div style="position:relative;width:165mm;min-height:75mm">

      <!-- Address zone: left column (80mm wide) -->
      <div style="position:absolute;top:0;left:0;width:80mm">
        <!-- Sender return line (Ruecksendeangabe) -->
        <div style="font-size:6.5pt;color:#999;border-bottom:0.5pt solid #bbb;padding-bottom:1px;margin-bottom:3mm;line-height:1.2">
          ${d.companyName} \u00b7 ${d.companyStreet} \u00b7 ${d.companyZip} ${d.companyCity}
        </div>
        <!-- Recipient address -->
        <div style="font-size:10pt;line-height:1.45">
          ${d.employeeName}<br/>
          ${d.employeeStreet ? `${d.employeeStreet}<br/>` : ''}${d.employeeZip ? `${d.employeeZip} ${d.employeeCity}` : ''}
        </div>
      </div>

      <!-- Info block: right column -->
      <div style="position:absolute;top:0;right:0;width:75mm">
        ${logo}
        <div style="font-size:7.5pt;color:#444;line-height:1.5;margin-bottom:4mm">
          ${d.companyName}<br/>
          ${d.companyStreet}<br/>
          ${d.companyZip} ${d.companyCity}<br/>
          ${d.companyPhone ? `Tel. ${d.companyPhone}<br/>` : ''}${d.companyEmail ? `${d.companyEmail}<br/>` : ''}${d.companyVat ? `USt-IdNr. ${d.companyVat}` : ''}
        </div>
        <table style="font-size:8pt;border-collapse:collapse;width:100%">
          <tr><td style="padding:1px 6px 1px 0;color:#666;width:40%">Datum</td><td style="font-weight:600">${d.letterDate}</td></tr>
          <tr><td style="padding:1px 6px 1px 0;color:#666">Zeichen</td><td style="font-weight:600">KW-${d.recordId}</td></tr>
          ${infoRows}
        </table>
      </div>
    </div>

    <!-- === BODY (flows below header) === -->
    <div style="margin-top:8mm">
      ${bodyContent}
    </div>`;
}

function signatureBlock(companyName: string): string {
  return `
    <div style="margin-top:10mm">
      Mit freundlichen Gr\u00fc\u00dfen<br/><br/><br/><br/>
      <div style="border-top:0.5pt solid #333;width:55mm;padding-top:1mm;font-size:8.5pt;color:#333">
        ${companyName}<br/>Gesch\u00e4ftsf\u00fchrung
      </div>
    </div>`;
}

function empfangsbestaetigung(): string {
  return `
    <div style="margin-top:12mm;padding-top:4mm;border-top:0.5pt dashed #aaa;font-size:8.5pt;color:#555">
      <strong style="font-size:9pt;color:#333">Empfangsbest\u00e4tigung</strong><br/><br/>
      Ich best\u00e4tige hiermit den Erhalt der K\u00fcndigung.<br/><br/>
      <table style="width:100%;border-collapse:collapse"><tr>
        <td style="width:50%;padding-top:10mm;vertical-align:bottom"><div style="border-top:0.5pt solid #333;width:50mm;padding-top:1mm">Ort, Datum</div></td>
        <td style="width:50%;padding-top:10mm;vertical-align:bottom"><div style="border-top:0.5pt solid #333;width:50mm;padding-top:1mm">Unterschrift Arbeitnehmer/in</div></td>
      </tr></table>
    </div>`;
}

function buildOrdentliche(d: LetterData): string {
  const infoRows = `
    <tr><td style="padding:1px 6px 1px 0;color:#666">Frist</td><td style="font-weight:600">${d.noticePeriodText}</td></tr>
    <tr><td style="padding:1px 6px 1px 0;color:#666">Letzter Tag</td><td style="font-weight:600">${d.lastWorkingDay}</td></tr>`;
  const body = `
    <p style="font-size:11pt;font-weight:bold;margin:0 0 5mm 0">K\u00fcndigung des Arbeitsverh\u00e4ltnisses</p>
    <p>${salutation(d.employeeGender, d.employeeName)}</p>
    <p>hiermit k\u00fcndigen wir das mit Ihnen bestehende Arbeitsverh\u00e4ltnis ordentlich unter Beachtung der f\u00fcr Sie geltenden K\u00fcndigungsfrist, demzufolge nach unseren Berechnungen zum <strong>${d.lastWorkingDay}</strong>, hilfsweise zum n\u00e4chstm\u00f6glichen Zeitpunkt.</p>
    <p>Nach \u00a7 38 SGB III sind Sie verpflichtet, sich innerhalb von drei Tagen nach Erhalt dieser K\u00fcndigung bei der zust\u00e4ndigen Agentur f\u00fcr Arbeit arbeitssuchend zu melden. Sofern das Arbeitsverh\u00e4ltnis noch l\u00e4nger als drei Monate besteht, ist eine Meldung drei Monate vor der Beendigung ausreichend. Sie sind auch verpflichtet, aktiv nach einer Besch\u00e4ftigung zu suchen. Sollten Sie diesen Verpflichtungen nicht nachkommen, m\u00fcssen Sie mit Nachteilen beim Bezug von Arbeitslosengeld rechnen.</p>
    <p>Bitte best\u00e4tigen Sie den Erhalt dieses Schreibens auf der beigef\u00fcgten Kopie.</p>
    ${signatureBlock(d.companyName)}
    ${empfangsbestaetigung()}`;
  return wrapPage(d, infoRows, body);
}

function buildFristlose(d: LetterData): string {
  const infoRows = `<tr><td style="padding:1px 6px 1px 0;color:#666">Wirkung</td><td style="font-weight:600">Sofort</td></tr>`;
  const body = `
    <p style="font-size:11pt;font-weight:bold;margin:0 0 5mm 0">Au\u00dferordentliche fristlose K\u00fcndigung</p>
    <p>${salutation(d.employeeGender, d.employeeName)}</p>
    <p>hiermit k\u00fcndigen wir das mit Ihnen bestehende Arbeitsverh\u00e4ltnis au\u00dferordentlich und fristlos mit sofortiger Wirkung, d.h. mit Zugang dieses Schreibens.</p>
    <p>Nach \u00a7 38 SGB III sind Sie verpflichtet, sich innerhalb von drei Tagen nach Erhalt dieser K\u00fcndigung bei der zust\u00e4ndigen Agentur f\u00fcr Arbeit arbeitssuchend zu melden. Weiterhin sind Sie verpflichtet, aktiv nach einer Besch\u00e4ftigung zu suchen.</p>
    <p>Bitte best\u00e4tigen Sie den Erhalt dieses Schreibens auf der beigef\u00fcgten Kopie.</p>
    ${signatureBlock(d.companyName)}
    ${empfangsbestaetigung()}`;
  return wrapPage(d, infoRows, body);
}

function buildAufhebung(d: LetterData): string {
  const infoRows = `<tr><td style="padding:1px 6px 1px 0;color:#666">Beendigung</td><td style="font-weight:600">${d.lastWorkingDay}</td></tr>`;
  let secNum = 1;
  let body = `
    <p style="font-size:11pt;font-weight:bold;margin:0 0 5mm 0">Aufhebungsvertrag</p>
    <p style="margin-bottom:1mm">zwischen</p>
    <p style="margin-left:5mm;margin-bottom:1mm">${d.companyName}, ${d.companyStreet}, ${d.companyZip} ${d.companyCity}<br/>\u2013 nachfolgend \u201eArbeitgeber\u201c \u2013</p>
    <p style="margin-bottom:1mm">und</p>
    <p style="margin-left:5mm;margin-bottom:4mm">${d.employeeName}${d.employeeStreet ? `, ${d.employeeStreet}, ${d.employeeZip} ${d.employeeCity}` : ''}<br/>\u2013 nachfolgend \u201eArbeitnehmer/in\u201c \u2013</p>
    <p style="font-weight:bold;margin-bottom:1mm">\u00a7 ${secNum++} Beendigung des Arbeitsverh\u00e4ltnisses</p>
    <p>Die Parteien sind sich dar\u00fcber einig, dass das ${d.employeeStartDate ? `am ${d.employeeStartDate} begr\u00fcndete ` : ''}Arbeitsverh\u00e4ltnis im gegenseitigen Einvernehmen mit Ablauf des <strong>${d.lastWorkingDay}</strong> endet.</p>`;
  if (d.gardenLeave) {
    body += `<p style="font-weight:bold;margin-bottom:1mm">\u00a7 ${secNum++} Freistellung</p>
      <p>Der/die Arbeitnehmer/in wird unwiderruflich unter Fortzahlung der Verg\u00fctung und Anrechnung von Urlaubsanspr\u00fcchen freigestellt.</p>`;
  }
  if (d.includeSeverance && d.severanceAmount) {
    body += `<p style="font-weight:bold;margin-bottom:1mm">\u00a7 ${secNum++} Abfindung</p>
      <p>Abfindung in H\u00f6he von <strong>${d.severanceAmount.toFixed(2)} EUR</strong> (brutto), f\u00e4llig mit der letzten Gehaltsabrechnung.</p>`;
  }
  body += `<p style="font-weight:bold;margin-bottom:1mm">\u00a7 ${secNum++} Arbeitszeugnis</p>
    <p>Wohlwollendes, qualifiziertes Arbeitszeugnis mit Dankes- und Bedauernsformel.</p>
    <p style="font-weight:bold;margin-bottom:1mm">\u00a7 ${secNum++} Hinweis \u00a7 38 SGB III</p>
    <p>Unverz\u00fcgliche Meldung bei der Agentur f\u00fcr Arbeit erforderlich.</p>
    <p style="font-weight:bold;margin-bottom:1mm">\u00a7 ${secNum++} Ausgleichsklausel</p>
    <p>S\u00e4mtliche wechselseitigen Anspr\u00fcche abgegolten und erledigt.</p>
    <div style="margin-top:12mm"><table style="width:100%;border-collapse:collapse"><tr>
      <td style="width:50%;padding-top:12mm;vertical-align:bottom"><div style="border-top:0.5pt solid #333;width:55mm;padding-top:1mm;font-size:8.5pt;color:#333">Ort, Datum / Arbeitgeber</div></td>
      <td style="width:50%;padding-top:12mm;vertical-align:bottom"><div style="border-top:0.5pt solid #333;width:55mm;padding-top:1mm;font-size:8.5pt;color:#333">Ort, Datum / Arbeitnehmer/in</div></td>
    </tr></table></div>`;
  return wrapPage(d, infoRows, body);
}

function buildBestaetigung(d: LetterData): string {
  const infoRows = `
    <tr><td style="padding:1px 6px 1px 0;color:#666">Erhalten</td><td style="font-weight:600">${d.resignationReceivedDate || '---'}</td></tr>
    <tr><td style="padding:1px 6px 1px 0;color:#666">Letzter Tag</td><td style="font-weight:600">${d.lastWorkingDay}</td></tr>`;
  const body = `
    <p style="font-size:11pt;font-weight:bold;margin:0 0 5mm 0">Best\u00e4tigung Ihrer K\u00fcndigung</p>
    <p>${salutation(d.employeeGender, d.employeeName)}</p>
    <p>hiermit best\u00e4tigen wir den Erhalt Ihrer K\u00fcndigung vom ${d.resignationReceivedDate || '___'}.</p>
    <p>Ihr Arbeitsverh\u00e4ltnis endet zum <strong>${d.lastWorkingDay}</strong>.</p>
    <p>Bitte geben Sie alle firmeneigenen Gegenst\u00e4nde, Schl\u00fcssel und Ger\u00e4te zur\u00fcck.</p>
    <p>Sie haben Anspruch auf ein wohlwollendes Arbeitszeugnis.</p>
    <p>Gem\u00e4\u00df \u00a7 38 SGB III m\u00fcssen Sie sich innerhalb von drei Tagen bei der Agentur f\u00fcr Arbeit melden.</p>
    <p>F\u00fcr die Zusammenarbeit bedanken wir uns und w\u00fcnschen Ihnen alles Gute.</p>
    ${signatureBlock(d.companyName)}`;
  return wrapPage(d, infoRows, body);
}

export function buildLetterHtml(d: LetterData): string {
  let content: string;
  switch (d.terminationType) {
    case 'fristlos': content = buildFristlose(d); break;
    case 'aufhebung': content = buildAufhebung(d); break;
    case 'bestaetigung': content = buildBestaetigung(d); break;
    default: content = buildOrdentliche(d); break;
  }
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"/><style>
  @page { size: A4; margin: 20mm 20mm 25mm 25mm; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10pt;
    line-height: 1.5;
    color: #000;
    margin: 0;
  }
  p {
    margin: 0 0 2.5mm 0;
  }
  table { border-collapse: collapse; }
  strong { font-weight: 700; }
</style></head>
<body>${content}</body></html>`;
}

export async function generatePdf(html: string): Promise<Buffer> {
  const id = randomBytes(8).toString('hex');
  const htmlPath = join(tmpdir(), `kw_term_${id}.html`);
  const pdfPath = join(tmpdir(), `kw_term_${id}.pdf`);

  writeFileSync(htmlPath, html, 'utf-8');

  return new Promise((resolve, reject) => {
    const cmd = `${WKHTMLTOPDF} --encoding utf-8 --page-size A4 --margin-top 20mm --margin-bottom 25mm --margin-left 25mm --margin-right 20mm --dpi 96 --quiet "${htmlPath}" "${pdfPath}"`;
    exec(cmd, { timeout: 30000 }, (err) => {
      try {
        const pdf = readFileSync(pdfPath);
        unlinkSync(htmlPath);
        unlinkSync(pdfPath);
        if (pdf.length < 100) {
          reject(new Error('PDF generation failed - empty output'));
        } else {
          resolve(pdf);
        }
      } catch (readErr) {
        reject(err || readErr);
      }
    });
  });
}
