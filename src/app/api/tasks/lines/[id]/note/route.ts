import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { setLineNote, getLineSummary } from '@/lib/odoo-tasks';
import { getDb } from '@/lib/db';
import { sendPushToUsers } from '@/lib/push';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({ error: 'No employee record linked' }, { status: 409 });
    }
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json();
    const note = typeof body.note === 'string' ? body.note : '';
    await setLineNote(id, note, user.employee_id);

    // Best-effort push: ping every active manager/admin (except the saver) when a
    // note is added or updated. Fires asynchronously — failures never block the
    // primary response.
    if (note.trim()) {
      (async () => {
        try {
          const summary = await getLineSummary(id);
          const rows = getDb().prepare(
            "SELECT id FROM portal_users WHERE active = 1 AND status = 'active' AND role IN ('manager', 'admin') AND id != ?"
          ).all(user.id) as { id: number }[];
          if (rows.length === 0) return;
          const snippet = note.length > 90 ? note.slice(0, 87) + '…' : note;
          await sendPushToUsers(rows.map(r => r.id), {
            title: `📝 ${user.name}: ${summary?.line_name ?? 'task note'}`,
            body: snippet,
            url: summary?.list_id
              ? `/tasks/manager/dept/${summary.department_id}?date=${summary.date}`
              : '/tasks/manager',
            tag: `note-${id}`,
          });
        } catch (e) {
          console.error('[push] note notify failed', e);
        }
      })();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to save note';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
