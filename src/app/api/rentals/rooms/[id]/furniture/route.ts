// src/app/api/rentals/rooms/[id]/furniture/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { RoomFurniture } from '@/types/rentals';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const roomId = Number(params.id);
    const items = db.prepare(
      `SELECT * FROM room_furniture WHERE room_id = ? ORDER BY item_order, id`
    ).all(roomId) as RoomFurniture[];
    return NextResponse.json({ furniture: items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const roomId = Number(params.id);
    const body = await req.json();
    const { item_name, quantity, condition, notes } = body;

    if (!item_name) {
      return NextResponse.json({ error: 'item_name required' }, { status: 400 });
    }

    const now = berlinNow();
    const maxOrder = db.prepare(
      `SELECT COALESCE(MAX(item_order), 0) as mx FROM room_furniture WHERE room_id = ?`
    ).get(roomId) as { mx: number };

    const result = db.prepare(`
      INSERT INTO room_furniture (room_id, item_name, quantity, condition, checked, notes, item_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(roomId, item_name, quantity ?? 1, condition ?? null, notes ?? null, maxOrder.mx + 1, now, now);

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Bulk update: toggle checked, update condition
  try {
    const db = getRentalsDb();
    const body = await req.json();
    const { items } = body as { items: { id: number; checked?: 0 | 1; condition?: string; notes?: string }[] };

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'items array required' }, { status: 400 });
    }

    const now = berlinNow();
    const stmt = db.prepare(`UPDATE room_furniture SET checked = ?, condition = ?, notes = ?, updated_at = ? WHERE id = ? AND room_id = ?`);
    const roomId = Number(params.id);

    db.transaction(() => {
      for (const item of items) {
        const current = db.prepare(`SELECT * FROM room_furniture WHERE id = ? AND room_id = ?`).get(item.id, roomId) as RoomFurniture | undefined;
        if (!current) continue;
        stmt.run(
          item.checked ?? current.checked,
          item.condition !== undefined ? item.condition : current.condition,
          item.notes !== undefined ? item.notes : current.notes,
          now, item.id, roomId
        );
      }
    })();

    return NextResponse.json({ updated: items.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const roomId = Number(params.id);
    const body = await req.json();
    const { furniture_id } = body;

    if (!furniture_id) {
      return NextResponse.json({ error: 'furniture_id required' }, { status: 400 });
    }

    const result = db.prepare(`DELETE FROM room_furniture WHERE id = ? AND room_id = ?`).run(furniture_id, roomId);
    return NextResponse.json({ deleted: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
