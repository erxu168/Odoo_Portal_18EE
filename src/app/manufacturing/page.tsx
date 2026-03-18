'use client';

import React, { useState } from 'react';
import BomList from '@/components/manufacturing/BomList';
import BomDetail from '@/components/manufacturing/BomDetail';
import CreateMo from '@/components/manufacturing/CreateMo';
import WorkOrderList from '@/components/manufacturing/WorkOrderList';
import ActiveWorkOrder from '@/components/manufacturing/ActiveWorkOrder';
import type { Bom } from '@/types/manufacturing';

type Screen =
  | { type: 'bom-list' }
  | { type: 'bom-detail'; bomId: number }
  | { type: 'create-mo'; bomId: number }
  | { type: 'mo-work-orders'; moId: number }
  | { type: 'active-wo'; moId: number; woId: number };

export default function ManufacturingPage() {
  const [screen, setScreen] = useState<Screen>({ type: 'bom-list' });

  switch (screen.type) {
    case 'bom-list':
      return (
        <BomList
          onSelect={(bom: Bom) =>
            setScreen({ type: 'bom-detail', bomId: bom.id })
          }
        />
      );

    case 'bom-detail':
      return (
        <BomDetail
          bomId={screen.bomId}
          onBack={() => setScreen({ type: 'bom-list' })}
          onCreateMo={(bomId) => setScreen({ type: 'create-mo', bomId })}
        />
      );

    case 'create-mo':
      return (
        <CreateMo
          bomId={screen.bomId}
          onBack={() =>
            setScreen({ type: 'bom-detail', bomId: screen.bomId })
          }
          onCreated={(moId) =>
            setScreen({ type: 'mo-work-orders', moId })
          }
        />
      );

    case 'mo-work-orders':
      return (
        <WorkOrderList
          moId={screen.moId}
          onBack={() => setScreen({ type: 'bom-list' })}
          onSelectWo={(woId) =>
            setScreen({
              type: 'active-wo',
              moId: screen.moId,
              woId,
            })
          }
        />
      );

    case 'active-wo':
      return (
        <ActiveWorkOrder
          moId={screen.moId}
          woId={screen.woId}
          onBack={() =>
            setScreen({ type: 'mo-work-orders', moId: screen.moId })
          }
          onDone={() =>
            setScreen({ type: 'mo-work-orders', moId: screen.moId })
          }
        />
      );
  }
}
