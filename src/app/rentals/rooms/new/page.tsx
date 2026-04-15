'use client';

import { Suspense } from 'react';
import AddRoom from '@/components/rentals/AddRoom';

export default function AddRoomPage() {
  return (
    <Suspense>
      <AddRoom />
    </Suspense>
  );
}
