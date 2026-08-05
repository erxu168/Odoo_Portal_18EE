import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /labels on module access — see src/lib/module-access.ts.
 * One file covers the whole folder, so a screen added here later cannot forget it.
 */
export default function LabelsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={'labels'}>{children}</ModuleGate>;
}
