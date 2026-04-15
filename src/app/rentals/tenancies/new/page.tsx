'use client';

import { Suspense } from 'react';
import CreateTenancy from '@/components/rentals/CreateTenancy';

export default function CreateTenancyPage() {
  return (
    <Suspense>
      <CreateTenancy />
    </Suspense>
  );
}
