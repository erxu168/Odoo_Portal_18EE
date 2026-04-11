/**
 * /api/issues/media
 *
 * POST — upload photo/video for an issue. Stores file on disk under data/issues-media.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initIssuesTables, addMedia, getIssue } from '@/lib/issues-db';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

initIssuesTables();

const MEDIA_DIR = join(process.cwd(), 'data', 'issues-media');

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { issue_id, data, type, phase } = body;

  if (!issue_id || !data) {
    return NextResponse.json({ error: 'issue_id and data required' }, { status: 400 });
  }

  const issue = getIssue(issue_id);
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
  }

  const matches = (data as string).match(/^data:(image|video)\/([\w+]+);base64,(.+)$/);
  if (!matches) {
    return NextResponse.json({ error: 'Invalid base64 data' }, { status: 400 });
  }

  const mimeType = matches[1] as 'image' | 'video';
  const ext = matches[2] === 'jpeg' ? 'jpg' : matches[2];
  const buffer = Buffer.from(matches[3], 'base64');

  const filename = `${issue_id}_${Date.now()}.${ext}`;
  const filePath = join(MEDIA_DIR, filename);
  writeFileSync(filePath, buffer);

  const thumbnail = mimeType === 'image' ? data.substring(0, 200) : null;

  const mediaType = type || (mimeType === 'video' ? 'video' : 'photo');
  const mediaPhase = phase || 'before';

  const id = addMedia(issue_id, filePath, mediaType, mediaPhase, thumbnail);

  return NextResponse.json({ id, file_path: filePath, message: 'Media uploaded' }, { status: 201 });
}
