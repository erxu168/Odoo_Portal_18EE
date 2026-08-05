import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { userModuleIds } from '@/lib/module-access';

/**
 * GET /api/auth/modules
 * Just the module ids the current user may use — nothing else.
 *
 * Exists because /api/auth/me does an Odoo RPC to fetch the avatar. Global
 * chrome that only needs to know "which modules may I show" (AppTabBar renders
 * on EVERY page) must not pay for an Odoo round-trip on every page load,
 * especially on the kitchen tablets. Session lookup only, no Odoo, no I/O
 * beyond SQLite.
 *
 * /api/auth is a public path in middleware.ts, so this handler does its own
 * 401 rather than relying on the session redirect.
 */
export async function GET() {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json({ modules: userModuleIds(user), role: user.role });
}
