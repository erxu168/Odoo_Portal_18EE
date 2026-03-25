import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';

export async function GET(_req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const employees = await odoo.searchRead('hr.employee', [
      ['id', '=', user.employee_id],
    ], ['image_1920'], { limit: 1 });

    if (!employees || employees.length === 0 || !employees[0].image_1920) {
      return new NextResponse(null, { status: 404 });
    }

    const imageBase64 = employees[0].image_1920 as string;
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err: unknown) {
    console.error('GET /api/hr/employee/photo error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch photo' },
      { status: 500 }
    );
  }
}
