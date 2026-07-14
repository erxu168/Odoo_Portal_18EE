import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { saveSubscription, deleteSubscriptionByEndpoint } from '@/lib/push';

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth();
    const body = await req.json();
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    const ua = req.headers.get('user-agent');
    saveSubscription(user.id, sub, ua);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to subscribe';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    requireAuth();
    const body = await req.json();
    if (!body?.endpoint) {
      return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    }
    deleteSubscriptionByEndpoint(body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to unsubscribe';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
