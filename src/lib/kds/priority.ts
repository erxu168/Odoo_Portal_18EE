/**
 * KDS priority, timer tiers, and task grouping utilities.
 * Pure functions — no side effects, no state.
 */
import type { KdsOrder, KdsSettings, TimerTier, TaskGroup, OrderType, ProductConfig, FireLane, FireTask, PrepType, SourceStation } from '@/types/kds';
import { SOURCES, PREP_TYPE_ORDER, PREP_TYPE_META } from '@/types/kds';

export function effectiveWait(order: KdsOrder, boost: number): number {
  return order.waitMin + (order.type === 'Takeaway' ? boost : 0);
}

export function timerTier(waitMin: number, type: OrderType, settings: KdsSettings): TimerTier {
  if (type === 'Takeaway') {
    if (waitMin >= settings.taUrg) return 'red';
    if (waitMin >= settings.taWarn) return 'orange';
    return 'green';
  }
  if (waitMin >= settings.dineUrg) return 'red';
  if (waitMin >= settings.dineWarn) return 'orange';
  return 'green';
}

export function passTier(readyAt: number, settings: KdsSettings): TimerTier {
  const min = Math.floor((Date.now() - readyAt) / 60000);
  if (min >= settings.passCrit) return 'red';
  if (min >= settings.passWarn) return 'orange';
  return 'green';
}

export function passMinutes(readyAt: number): string {
  const min = Math.floor((Date.now() - readyAt) / 60000);
  return min > 0 ? `${min}m ago` : 'Just now';
}

export function sortByEffectiveWait(orders: KdsOrder[], boost: number): KdsOrder[] {
  return [...orders].sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));
}

export function mostUrgentOrderId(orders: KdsOrder[], boost: number): number | null {
  const active = orders.filter(o => o.items.some(i => !i.done));
  if (active.length === 0) return null;
  const sorted = sortByEffectiveWait(active, boost);
  return sorted[0].id;
}

export function buildTaskGroups(orders: KdsOrder[], boost: number): TaskGroup[] {
  const map: Record<string, TaskGroup> = {};

  for (const order of orders) {
    for (const item of order.items) {
      if (!map[item.name]) {
        map[item.name] = { name: item.name, entries: [], totalQty: 0, servedQty: 0, remainQty: 0, allDone: false, priority: 0 };
      }
      map[item.name].entries.push({
        ticketId: order.id,
        itemId: item.id,
        qty: item.qty,
        table: order.table,
        type: order.type,
        note: item.note || null,
        done: item.done,
        waitMin: order.waitMin,
        effectiveWait: effectiveWait(order, boost),
      });
    }
  }

  const tasks = Object.values(map);
  for (const task of tasks) {
    task.entries.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.effectiveWait - a.effectiveWait;
    });
    task.totalQty = task.entries.reduce((s, e) => s + e.qty, 0);
    task.servedQty = task.entries.filter(e => e.done).reduce((s, e) => s + e.qty, 0);
    task.remainQty = task.totalQty - task.servedQty;
    task.allDone = task.entries.every(e => e.done);
    const unserved = task.entries.filter(e => !e.done);
    task.priority = unserved.length > 0 ? Math.max(...unserved.map(e => e.effectiveWait)) : 0;
  }

  tasks.sort((a, b) => {
    if (a.allDone !== b.allDone) return a.allDone ? 1 : -1;
    return b.priority - a.priority;
  });

  return tasks;
}

export function getTableRemaining(orders: KdsOrder[], ticketId: number): { name: string; qty: number }[] {
  const order = orders.find(o => o.id === ticketId);
  if (!order) return [];
  return order.items.filter(i => !i.done).map(i => ({ name: i.name, qty: i.qty }));
}

/**
 * Build a fire plan: items grouped by prep priority, batched by station,
 * identical items consolidated across orders.
 *
 * Priority order: ondemand (bottleneck, start first) -> batch -> advance (just plate)
 * Within each lane: sorted by urgency (longest wait first)
 * Identical items across orders consolidated into one task
 */
export function buildFirePlan(
  orders: KdsOrder[],
  boost: number,
  productConfig: ProductConfig[],
): FireLane[] {
  const configMap = new Map<string, { sourceStation: SourceStation; prepType: PrepType }>();
  for (const pc of productConfig) {
    configMap.set(pc.productName, {
      sourceStation: pc.sourceStation as SourceStation,
      prepType: pc.prepType as PrepType,
    });
  }

  function getConfig(itemName: string): { sourceStation: SourceStation; prepType: PrepType } {
    const fromDb = configMap.get(itemName);
    if (fromDb) return fromDb;
    const fromSources = SOURCES[itemName];
    return {
      sourceStation: fromSources?.source || 'cold',
      prepType: 'ondemand',
    };
  }

  const taskMap: Record<string, FireTask> = {};

  for (const order of orders) {
    for (const item of order.items) {
      const cfg = getConfig(item.name);
      if (!taskMap[item.name]) {
        taskMap[item.name] = {
          name: item.name,
          totalQty: 0,
          doneQty: 0,
          tables: [],
          entries: [],
          sourceStation: cfg.sourceStation,
          prepType: cfg.prepType,
        };
      }
      const task = taskMap[item.name];
      task.totalQty += item.qty;
      if (item.done) task.doneQty += item.qty;
      if (!task.tables.includes(order.table)) task.tables.push(order.table);
      task.entries.push({
        ticketId: order.id,
        itemId: item.id,
        qty: item.qty,
        table: order.table,
        type: order.type,
        note: item.note || null,
        done: item.done,
        waitMin: order.waitMin,
        effectiveWait: effectiveWait(order, boost),
      });
    }
  }

  const tasks = Object.values(taskMap);
  for (const task of tasks) {
    task.entries.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.effectiveWait - a.effectiveWait;
    });
  }

  const lanes: FireLane[] = [];
  for (const prepType of PREP_TYPE_ORDER) {
    const meta = PREP_TYPE_META[prepType];
    const laneTasks = tasks
      .filter(t => t.prepType === prepType && t.totalQty > t.doneQty)
      .sort((a, b) => {
        const aMax = Math.max(...a.entries.filter(e => !e.done).map(e => e.effectiveWait), 0);
        const bMax = Math.max(...b.entries.filter(e => !e.done).map(e => e.effectiveWait), 0);
        return bMax - aMax;
      });

    if (laneTasks.length > 0) {
      lanes.push({
        prepType,
        label: meta.label,
        emoji: meta.emoji,
        tasks: laneTasks,
      });
    }
  }

  return lanes;
}
