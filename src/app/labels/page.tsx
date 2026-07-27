'use client';

import { useRouter } from 'next/navigation';
import LabelPrint from '@/components/manufacturing/LabelPrint';

/**
 * Standalone Label Printer route. Reuses the Manufacturing LabelPrint screen (the ONE
 * label-printer editor) so the shared department tablet — and anyone — can open it
 * directly from a dashboard tile, not only from inside Manufacturing. Stable URL: /labels.
 */
export default function LabelsPage() {
  const router = useRouter();
  return <LabelPrint onBack={() => router.push('/')} onDone={() => router.push('/')} />;
}
