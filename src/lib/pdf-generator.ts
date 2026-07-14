// src/lib/pdf-generator.ts
// HTML → PDF via Puppeteer (same pattern as termination v2 module)
// Krawings Portal · krawings_rentals v1.1.0
//
// Puppeteer is already in the repo for Termination v2 — we reuse the same
// launch flags. If Puppeteer is unavailable on the server, fall back to
// wkhtmltopdf via child_process (ARM64 patched version is installed on staging).

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

let puppeteerAvailable: boolean | null = null;

async function tryPuppeteer(): Promise<typeof import('puppeteer') | null> {
  if (puppeteerAvailable === false) return null;
  try {
    const pup = await import('puppeteer');
    puppeteerAvailable = true;
    return pup;
  } catch {
    puppeteerAvailable = false;
    return null;
  }
}

export async function htmlToPdf(html: string, outPath: string): Promise<void> {
  const pup = await tryPuppeteer();

  if (pup) {
    try {
      const browser = await pup.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({
          path: outPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '25mm', right: '20mm', bottom: '25mm', left: '25mm' },
        });
      } finally {
        await browser.close();
      }
      return;
    } catch (e) {
      // Puppeteer imported fine but Chromium won't launch/render here (e.g. the
      // ARM Chromium binary is broken on staging). Remember that, and fall
      // through to the wkhtmltopdf path instead of failing the whole render.
      puppeteerAvailable = false;
      console.error(
        '[pdf-generator] Puppeteer failed, falling back to wkhtmltopdf:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  await wkhtmltopdf(html, outPath);
}

// wkhtmltopdf fallback (WebKit, works on the ARM staging box; also used by the
// termination flow). Uses the absolute install path when present, since the
// service PATH may not include /usr/local/bin.
async function wkhtmltopdf(html: string, outPath: string): Promise<void> {
  const tmpHtml = outPath.replace(/\.pdf$/, '.tmp.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const bin = fs.existsSync('/usr/local/bin/wkhtmltopdf') ? '/usr/local/bin/wkhtmltopdf' : 'wkhtmltopdf';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, [
      '--enable-local-file-access',
      '--encoding', 'utf-8',
      '--margin-top', '25mm',
      '--margin-right', '20mm',
      '--margin-bottom', '25mm',
      '--margin-left', '25mm',
      '--page-size', 'A4',
      '--dpi', '150',
      '--quiet',
      tmpHtml,
      outPath,
    ]);
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      try { fs.unlinkSync(tmpHtml); } catch { /* best-effort cleanup */ }
      if (code === 0) resolve();
      else reject(new Error(`wkhtmltopdf exited ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

export function pdfOutputPath(kind: string, id: number): string {
  const dir = process.env.PORTAL_PDF_DIR || path.join(process.cwd(), 'data', 'pdfs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${kind}_${id}_${Date.now()}.pdf`);
}
