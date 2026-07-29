import type { Metadata } from 'next';
import FloorplanPrintView from '@/components/inventory/floorplan/FloorplanPrintView';

export const metadata: Metadata = { title: 'Print floor plan' };
export const dynamic = 'force-dynamic';

export default function FloorplanPrintPage({ searchParams }: { searchParams: { floor?: string } }) {
  return <FloorplanPrintView floorId={parseInt(searchParams.floor ?? '0', 10) || 0} />;
}
