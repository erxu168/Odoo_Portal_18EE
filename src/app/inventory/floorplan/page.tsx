import type { Metadata } from 'next';
import FloorplanApp from '@/components/inventory/floorplan/FloorplanApp';

export const metadata: Metadata = { title: 'Floorplan' };
export const dynamic = 'force-dynamic';

export default function FloorplanPage() {
  return <FloorplanApp />;
}
