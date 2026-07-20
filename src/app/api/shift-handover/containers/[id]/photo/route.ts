export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listPhotos, getContainer } from '@/lib/shift-handover/db';
import { addContainerPhoto, replaceContainerPhoto } from '@/lib/shift-handover/commands';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const c = getContainer(parseInt(params.id, 10));
  if (!c || c.company_id !== companyId) return jsonError(404, 'Container not found.');
  return NextResponse.json({ photos: listPhotos('container', c.id) });
}

// POST — attach (or replace) a photo. Body: { photo: dataURL, caption?, event?, replace_photo_id? }
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.record, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const containerId = parseInt(params.id, 10);
  const result = body?.replace_photo_id
    ? replaceContainerPhoto(companyId, authz.actor, containerId, parseInt(String(body.replace_photo_id), 10), body.photo, body.caption ?? null)
    : addContainerPhoto(companyId, authz.actor, containerId, body?.photo, body?.caption ?? null, body?.event || 'general');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
