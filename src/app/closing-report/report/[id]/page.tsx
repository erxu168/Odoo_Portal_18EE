import ReportRecord from '@/components/closing-report/ReportRecord';

export default function ClosingReportRecordPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  return <ReportRecord reportId={Number.isFinite(id) ? id : 0} />;
}
