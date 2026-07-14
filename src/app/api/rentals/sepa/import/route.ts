// src/app/api/rentals/sepa/import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { parseSepa } from '@/lib/sepa-parsers';
import { runMatcher } from '@/lib/sepa-matcher';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const userIdRaw = formData.get('user_id');
    const userId = userIdRaw ? Number(userIdRaw) : 0;

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const content = buf.toString('utf8');

    // Parse
    const { format, parsed } = parseSepa(file.name, content);

    // Persist raw file
    const rawDir = process.env.PORTAL_UPLOAD_DIR || path.join(process.cwd(), 'data', 'sepa');
    if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
    const rawPath = path.join(rawDir, `${Date.now()}_${file.name}`);
    fs.writeFileSync(rawPath, buf);

    const db = getRentalsDb();
    const now = berlinNow();

    const importId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO sepa_imports
        (filename, format, bank_name, iban, total_credits, tx_count, raw_path, imported_by_user_id, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        file.name, format, parsed.bank_name, parsed.iban,
        parsed.total_credits, parsed.tx_count, rawPath, userId, now
      );
      const id = Number(result.lastInsertRowid);

      const txStmt = db.prepare(`
        INSERT INTO sepa_transactions
        (import_id, tx_date, amount, counterparty_iban, counterparty_bic, counterparty_name,
         purpose, end_to_end_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?)
      `);
      for (const t of parsed.transactions) {
        txStmt.run(
          id, t.tx_date, t.amount,
          t.counterparty_iban, t.counterparty_bic, t.counterparty_name,
          t.purpose, t.end_to_end_id, now
        );
      }
      return id;
    })();

    // Run matcher
    const matchResult = runMatcher(importId);

    return NextResponse.json({
      import_id: importId,
      format,
      tx_count: parsed.tx_count,
      total_credits: parsed.total_credits,
      matched: matchResult.matched,
      partial: matchResult.partial,
      unmatched: matchResult.unmatched,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
