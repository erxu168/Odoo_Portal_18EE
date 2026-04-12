// src/app/api/rentals/photos/[...path]/route.ts
// Serve uploaded photos from /data/rentals/photos/
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PHOTO_BASE = path.join(process.env.PORTAL_DB_DIR || path.join(process.cwd(), 'data'), 'rentals', 'photos');

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    const segments = params.path;
    // Prevent directory traversal
    if (segments.some(s => s.includes('..') || s.includes('\0'))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const filePath = path.join(PHOTO_BASE, ...segments);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const buffer = fs.readFileSync(filePath);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
