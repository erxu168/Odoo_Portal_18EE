import PrepItemDetail from '@/components/prep-planner/PrepItemDetail';

export const dynamic = 'force-dynamic';

export default function PrepItemDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  return <PrepItemDetail itemId={id} />;
}
