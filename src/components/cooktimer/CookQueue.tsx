'use client';

import type { QueueGroup } from '@/types/cooktimer';
import { formatMMSS, queueAgeTier } from '@/lib/cooktimer-logic';

interface Props {
  queue: QueueGroup[];
  nowMs: number;
  colorById: Record<number, string>;
  onStart: (lineIds: number[]) => void;
}

/** TO COOK queue rail. Identical products are grouped; grouped cards batch. */
export default function CookQueue({ queue, nowMs, colorById, onStart }: Props) {
  return (
    <div className="ct-queue">
      <h2 className="ct-queue-h">TO COOK</h2>
      <div className="ct-queue-list">
        {queue.length === 0 ? (
          <div className="ct-queue-empty">No items waiting for this station.<br />New POS orders appear here.</div>
        ) : (
          queue.map(g => <QueueCard key={g.profileId} group={g} nowMs={nowMs} color={colorById[g.stationId] || '#8fa0b3'} onStart={onStart} />)
        )}
      </div>
    </div>
  );
}

function QueueCard({ group, nowMs, color, onStart }: { group: QueueGroup; nowMs: number; color: string; onStart: (ids: number[]) => void }) {
  const ageS = Math.max(0, (nowMs - group.oldestArrivedMs) / 1000);
  const tier = queueAgeTier(ageS);
  const n = group.count;
  const orderList = group.lines.map(l => (l.qty > 1 ? `${l.ref} ×${l.qty}` : l.ref)).join('  ');
  const allIds = group.lines.map(l => l.lineId);
  const oldestId = group.lines[0]?.lineId;

  const cardClick = n > 1 ? undefined : () => onStart([oldestId]);

  return (
    <div className={`ct-qcard ${tier ? `age-${tier}` : ''}`} onClick={cardClick}>
      <div className="ct-qtop">
        <span className="ct-order">{orderList}</span>
        <span className="ct-age">{formatMMSS(ageS)} waiting</span>
      </div>
      <div className="ct-qname">
        {group.profileName}{n > 1 && <span className="ct-xn"> ×{n}</span>}
      </div>
      <div className="ct-meta">
        <span className="ct-badge" style={{ background: color }}>{group.stationName.toUpperCase()}</span>
        <span className="ct-steps">{group.stepLabels.join(' → ')}</span>
      </div>
      {n > 1 ? (
        <div className="ct-qbtns">
          <button className="ct-qb" onClick={e => { e.stopPropagation(); onStart([oldestId]); }}>COOK 1</button>
          <button className="ct-qb all" onClick={e => { e.stopPropagation(); onStart(allIds); }}>COOK ALL ×{n}</button>
        </div>
      ) : (
        <div className="ct-tap">TAP TO START</div>
      )}
    </div>
  );
}
