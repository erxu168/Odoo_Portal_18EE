import ModuleGate from '@/components/ui/ModuleGate';

export default function ClosingReportLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={'closing-report'}>{children}</ModuleGate>;
}
