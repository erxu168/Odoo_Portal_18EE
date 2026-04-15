'use client';

import { Suspense } from 'react';
import RentIncreaseWizard from '@/components/rentals/RentIncreaseWizard';

export default function RentIncreasePage() {
  return (
    <Suspense>
      <RentIncreaseWizard />
    </Suspense>
  );
}
