import type { Metadata } from 'next';
import FloorplanUploadReview from '@/components/inventory/floorplan/FloorplanUploadReview';

export const metadata: Metadata = { title: 'Review floor plan' };
export const dynamic = 'force-dynamic';

export default function FloorplanReviewPage({ params }: { params: { revisionId: string } }) {
  return <FloorplanUploadReview revisionId={parseInt(params.revisionId, 10) || 0} />;
}
