import type { Metadata } from 'next';
import FloorplanManage from '@/components/inventory/floorplan/FloorplanManage';

export const metadata: Metadata = { title: 'Manage floor plans' };
export const dynamic = 'force-dynamic';

export default function FloorplanManagePage() {
  return <FloorplanManage />;
}
