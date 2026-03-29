/**
 * Termination letter PDF generator.
 * Builds HTML → calls wkhtmltopdf on the server → returns PDF buffer.
 * Native UTF-8 support — no encoding issues.
 */
import { exec } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const WKHTMLTOPDF = '/usr/local/bin/wkhtmltopdf';

interface LetterData {
  // Company
  companyName: string;
  companyStreet: string;
  companyZip: string;
  companyCity: string;
  companyPhone: string;
  companyEmail: string;
  companyVat: string;
  companyLogoBase64: string | null; // data:image/png;base64,...
  // Employee
  employeeName: string;
  employeeStreet: string;
  employeeZip: string;
  employeeCity: string;
  employeeGender: 'male' | 'female' | 'other';
  // Dates
  letterDate: string; // DD.MM.YYYY
  recordId: number;
  lastWorkingDay: string; // DD.MM.YYYY
  noticePeriodText: string;
  // Type-specific
  terminationType: string;
  employeeStartDate?: string;
  // Aufhebung
  includeSeverance?: boolean;
  severanceAmount?: number;
  gardenLeave?: boolean;
  // Bestaetigung
  resignationReceivedDate?: string;
}

function salutation(gender: string, lastName: string): string {
  if (gender === 'male') return `Sehr geehrter Herr ${lastName},`;
  if (gender === 'female') return `Sehr geehrte Frau ${lastName},`;
  return `Sehr geehrte/r Herr/Frau ${lastName},`;
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

function letterHead(d: LetterData, extraRows: string): string {
  const logo = d.companyLogoBase64
    ? `<img src="${d.companyLogoBase64}" style="max-height:18mm;max-width:50mm;margin-bottom:3mm" alt="Logo"/>`
    : '';
  return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:4mm">
      <tr>
        <td style="vertical-align:top;width:60%">
          <div style="font-size:7pt;color:#888;border-bottom:1px solid #ccc;padding-bottom:2px;margin-bottom:6px;width:85mm">
            ${d.companyName} \u00b7 ${d.companyStreet} \u00b7 ${d.companyZip} ${d.companyCity}
          </div>
          <div style="font-size:10pt;line-height:1.3;min-height:24mm">
            ${d.employeeName}<br/>
            ${d.employeeStreet}<br/>
            ${d.employeeZip} ${d.employeeCity}
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;width:40%">
          ${logo}
          <div style="font-size:7.5pt;color:#555;line-height:1.4;text-align:left;margin-top:3mm">
            ${d.companyName}<br/>${d.companyStreet}<br/>${d.companyZip} ${d.companyCity}<br/>
            ${d.companyPhone ? `Tel. ${d.companyPhone}<br/>` : ''}
            ${d.companyEmail ? `${d.companyEmail}<br/>` : ''}
            ${d.companyVat ? `USt-IdNr. ${d.companyVat}` : ''}
          </div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6mm;font-size:8pt">
      <tr><td style="width:60%"></td>
        <td style="width:40%;vertical-align:top">
          <table style="border-collapse:collapse;font-size:8pt">
            <tr><td style="padding:1px 8px 1px 0"><strong>Datum</strong></td><td>${d.letterDate}</td></tr>
            <tr><td style="padding:1px 8px 1px 0"><strong>Unser Zeichen</strong></td><td>KW-${d.recordId}</td></tr>
            ${extraRows}
          </table>
        </td>
      </tr>
    </table>`;
}

function signatureBlock(companyName: string): string {
  return `
    <div style="margin-top:8mm">
      Mit freundlichen Gr\u00fc\u00dfen<br/><br/><br/><br/>
      <div style="border-top:1px solid #333;width:55mm;padding-top:1mm;font-size:9pt">
        ${companyName}<br/>Gesch\u00e4ftsf\u00fchrung
      </div>
    </div>`;
}

function empfangsbestaetigung(): string {
  return `
    <div style="margin-top:10mm;padding-top:3mm;border-top:1px dashed #888;font-size:9pt;color:#444">
      <strong>Empfangsbest\u00e4tigung</strong><br/><br/>
      Ich best\u00e4tige hiermit den Erhalt der K\u00fcndigung.<br/><br/>
      <table style="width:100%;border-collapse:collapse"><tr>
        <td style="width:50%;padding-top:8mm;vertical-align:bottom"><div style="border-top:1px solid #333;width:50mm;padding-top:1mm">Ort, Datum</div></td>
        <td style="width:50%;padding-top:8mm;vertical-align:bottom"><div style="border-top:1px solid #333;width:50mm;padding-top:1mm">Unterschrift Arbeitnehmer/in</div></td>
      </tr></table>
    </div>`;
}

function buildOrdentliche(d: LetterData): string {
  const infoRows = `
    <tr><td style="padding:1px 8px 1px 0"><strong>K\u00fcndigungsfrist</strong></td><td>${d.noticePeriodText}</td></tr>
    <tr><td style="padding:1px 8px 1px 0"><strong>Letzter Arbeitstag</strong></td><td>${d.lastWorkingDay}</td></tr>`;
  return `
    ${letterHead(d, infoRows)}
    <p style="font-size:12pt;font-weight:bold;margin:0 0 4mm 0">K\u00fcndigung des Arbeitsverh\u00e4ltnisses</p>
    <p style="margin-bottom:3mm">${salutation(d.employeeGender, lastName(d.employeeName))}</p>
    <p style="margin-bottom:3mm">hiermit k\u00fcndigen wir das mit Ihnen bestehende Arbeitsverh\u00e4ltnis ordentlich unter Beachtung der f\u00fcr Sie geltenden K\u00fcndigungsfrist, demzufolge nach unseren Berechnungen zum <strong>${d.lastWorkingDay}</strong>, hilfsweise zum n\u00e4chstm\u00f6glichen Zeitpunkt.</p>
    <p style="margin-bottom:3mm">Nach \u00a7 38 SGB III sind Sie verpflichtet, sich innerhalb von drei Tagen nach Erhalt dieser K\u00fcndigung bei der zust\u00e4ndigen Agentur f\u00fcr Arbeit arbeitssuchend zu melden. Sofern das Arbeitsverh\u00e4ltnis noch l\u00e4nger als drei Monate besteht, ist eine Meldung drei Monate vor der Beendigung ausreichend. Sie sind auch verpflichtet, aktiv nach einer Besch\u00e4ftigung zu suchen. Sollten Sie diesen Verpflichtungen nicht nachkommen, m\u00fcssen Sie mit Nachteilen beim Bezug von Arbeitslosengeld rechnen.</p>
    <p style="margin-bottom:3mm">Bitte best\u00e4tigen Sie den Erhalt dieses Schreibens auf der beigef\u00fcgten Kopie.</p>
    ${signatureBlock(d.companyName)}
    ${empfangsbestaetigung()}`;
}

function buildFristlose(d: LetterData): string {
  const infoRows = `<tr><td style="padding:1px 8px 1px 0"><strong>Wirkung</strong></td><td>Sofort mit Zugang</td></tr>`;
  return `
    ${letterHead(d, infoRows)}
    <p style="font-size:12pt;font-weight:bold;margin:0 0 4mm 0">Au\u00dferordentliche fristlose K\u00fcndigung</p>
    <p style="margin-bottom:3mm">${salutation(d.employeeGender, lastName(d.employeeName))}</p>
    <p style="margin-bottom:3mm">hiermit k\u00fcndigen wir das mit Ihnen bestehende Arbeitsverh\u00e4ltnis au\u00dferordentlich und fristlos mit sofortiger Wirkung, d.h. mit Zugang dieses Schreibens.</p>
    <p style="margin-bottom:3mm">Nach \u00a7 38 SGB III sind Sie verpflichtet, sich innerhalb von drei Tagen nach Erhalt dieser K\u00fcndigung bei der zust\u00e4ndigen Agentur f\u00fcr Arbeit arbeitssuchend zu melden. Weiterhin sind Sie verpflichtet, aktiv nach einer Besch\u00e4ftigung zu suchen.</p>
    <p style="margin-bottom:3mm">Bitte best\u00e4tigen Sie den Erhalt dieses Schreibens auf der beigef\u00fcgten Kopie.</p>
    ${signatureBlock(d.companyName)}
    ${empfangsbestaetigung()}`;
}

function buildAufhebung(d: LetterData): string {
  const infoRows = `<tr><td style="padding:1px 8px 1px 0"><strong>Beendigung zum</strong></td><td>${d.lastWorkingDay}</td></tr>`;
  let secNum = 1;
  let body = `
    ${letterHead(d, infoRows)}
    <p style="font-size:12pt;font-weight:bold;margin:0 0 4mm 0">Aufhebungsvertrag</p>
    <p style="margin-bottom:2mm">zwischen</p>
    <p style="margin-left:5mm;margin-bottom:2mm">${d.companyName}, ${d.companyStreet}, ${d.companyZip} ${d.companyCity}<br/>\u2013 nachfolgend \u201eArbeitgeber\u201c genannt \u2013</p>
    <p style="margin-bottom:2mm">und</p>
    <p style="margin-left:5mm;margin-bottom:3mm">${d.employeeName}, ${d.employeeStreet}, ${d.employeeZip} ${d.employeeCity}<br/>\u2013 nachfolgend \u201eArbeitnehmer/in\u201c genannt \u2013</p>
    <p style="font-weight:bold;margin-bottom:2mm">\u00a7 ${secNum++} Beendigung des Arbeitsverh\u00e4ltnisses</p>
    <p style="margin-bottom:3mm">Die Parteien sind sich dar\u00fcber einig, dass das ${d.employeeStartDate ? `am ${d.employeeStartDate} begr\u00fcndete ` : ''}Arbeitsverh\u00e4ltnis im gegenseitigen Einvernehmen mit Ablauf des <strong>${d.lastWorkingDay}</strong> endet.</p>`;
  if (d.gardenLeave) {
    body += `<p style="font-weight:bold;margin-bottom:2mm">\u00a7 ${secNum++} Freistellung</p>
      <p style="margin-bottom:3mm">Der/die Arbeitnehmer/in wird unwiderruflich unter Fortzahlung der Verg\u00fctung und Anrechnung von Urlaubsanspr\u00fcchen freigestellt.</p>`;
  }
  if (d.includeSeverance && d.severanceAmount) {
    body += `<p style="font-weight:bold;margin-bottom:2mm">\u00a7 ${secNum++} Abfindung</p>
      <p style="margin-bottom:3mm">Abfindung in H\u00f6he von <strong>${d.severanceAmount.toFixed(2)} EUR</strong> (brutto), f\u00e4llig mit der letzten Gehaltsabrechnung.</p>`;
  }
  body += `<p style="font-weight:bold;margin-bottom:2mm">\u00a7 ${secNum++} Arbeitszeugnis</p>
    <p style="margin-bottom:3mm">Wohlwollendes, qualifiziertes Arbeitszeugnis mit Dankes- und Bedauernsformel.</p>
    <p style="font-weight:bold;margin-bottom:2mm">\u00a7 ${secNum++} Hinweis \u00a7 38 SGB III</p>
    <p style="margin-bottom:3mm">Unverz\u00fcgliche Meldung bei der Agentur f\u00fcr Arbeit erforderlich.</p>
    <p style="font-weight:bold;margin-bottom:2mm">\u00a7 ${secNum++} Ausgleichsklausel</p>
    <p style="margin-bottom:3mm">S\u00e4mtliche wechselseitigen Anspr\u00fcche abgegolten und erledigt.</p>
    <div style="margin-top:10mm"><table style="width:100%;border-collapse:collapse"><tr>
      <td style="width:50%;padding-top:12mm;vertical-align:bottom"><div style="border-top:1px solid #333;width:55mm;padding-top:1mm;font-size:9pt">Ort, Datum / Arbeitgeber</div></td>
      <td style="width:50%;padding-top:12mm;vertical-align:bottom"><div style="border-top:1px solid #333;width:55mm;padding-top:1mm;font-size:9pt">Ort, Datum / Arbeitnehmer/in</div></td>
    </tr></table></div>`;
  return body;
}

function buildBestaetigung(d: LetterData): string {
  const infoRows = `
    <tr><td style="padding:1px 8px 1px 0"><strong>K\u00fcndigung erhalten</strong></td><td>${d.resignationReceivedDate || '---'}</td></tr>
    <tr><td style="padding:1px 8px 1px 0"><strong>Letzter Arbeitstag</strong></td><td>${d.lastWorkingDay}</td></tr>`;
  return `
    ${letterHead(d, infoRows)}
    <p style="font-size:12pt;font-weight:bold;margin:0 0 4mm 0">Best\u00e4tigung Ihrer K\u00fcndigung</p>
    <p style="margin-bottom:3mm">${salutation(d.employeeGender, lastName(d.employeeName))}</p>
    <p style="margin-bottom:3mm">hiermit best\u00e4tigen wir den Erhalt Ihrer K\u00fcndigung vom ${d.resignationReceivedDate || '___'}.</p>
    <p style="margin-bottom:3mm">Ihr Arbeitsverh\u00e4ltnis endet zum <strong>${d.lastWorkingDay}</strong>.</p>
    <p style="margin-bottom:3mm">Bitte geben Sie alle firmeneigenen Gegenst\u00e4nde, Schl\u00fcssel und Ger\u00e4te zur\u00fcck.</p>
    <p style="margin-bottom:3mm">Sie haben Anspruch auf ein wohlwollendes Arbeitszeugnis.</p>
    <p style="margin-bottom:3mm">Gem\u00e4\u00df \u00a7 38 SGB III m\u00fcssen Sie sich innerhalb von drei Tagen bei der Agentur f\u00fcr Arbeit melden.</p>
    <p style="margin-bottom:3mm">F\u00fcr die Zusammenarbeit bedanken wir uns und w\u00fcnschen Ihnen alles Gute.</p>
    ${signatureBlock(d.companyName)}`;
}

export function buildLetterHtml(d: LetterData): string {
  let body: string;
  switch (d.terminationType) {
    case 'fristlos': body = buildFristlose(d); break;
    case 'aufhebung': body = buildAufhebung(d); break;
    case 'bestaetigung': body = buildBestaetigung(d); break;
    default: body = buildOrdentliche(d); break;
  }
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"/><style>
  @page { size: A4; margin: 10mm 15mm 20mm 25mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.4; color: #000; margin: 0; }
  p { margin: 0 0 3mm 0; }
  table { border-collapse: collapse; }
  strong { font-weight: bold; }
</style></head>
<body>${body}</body></html>`;
}

export async function generatePdf(html: string): Promise<Buffer> {
  const id = randomBytes(8).toString('hex');
  const htmlPath = join(tmpdir(), `kw_term_${id}.html`);
  const pdfPath = join(tmpdir(), `kw_term_${id}.pdf`);

  writeFileSync(htmlPath, html, 'utf-8');

  return new Promise((resolve, reject) => {
    const cmd = `${WKHTMLTOPDF} --encoding utf-8 --page-size A4 --margin-top 10mm --margin-bottom 20mm --margin-left 25mm --margin-right 15mm --quiet "${htmlPath}" "${pdfPath}"`;
    exec(cmd, { timeout: 30000 }, (err) => {
      try {
        // wkhtmltopdf returns exit code 1 for non-fatal warnings
        const pdf = readFileSync(pdfPath);
        unlinkSync(htmlPath);
        unlinkSync(pdfPath);
        if (pdf.length < 100) {
          reject(new Error('PDF generation failed — empty output'));
        } else {
          resolve(pdf);
        }
      } catch (readErr) {
        reject(err || readErr);
      }
    });
  });
}
