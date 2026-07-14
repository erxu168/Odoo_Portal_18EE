// src/app/api/rentals/inspections/[id]/photo/route.ts
// Upload a photo for an inspection item (or meter reading)
// Stores under PORTAL_UPLOAD_DIR/inspections/<inspection_id>/
// Returns the relative path to save into inspection_items.photo_paths_json
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const inspectionId = Number(params.id);
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    // Basic validation — photos only
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    const baseDir = process.env.PORTAL_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
    const targetDir = path.join(baseDir, 'inspections', String(inspectionId));
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const ext = path.extname(file.name) || '.jpg';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const absPath = path.join(targetDir, filename);
    const relPath = path.relative(process.cwd(), absPath);

    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absPath, buf);

    return NextResponse.json({
      path: relPath,
      filename,
      size: file.size,
      mime: file.type,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
