import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /shift-handover on module access — see src/lib/module-access.ts.
 * One file covers the whole folder, so a screen added here later cannot forget it.
 */
export default function ShiftHandoverLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={'shift-handover'}>{children}</ModuleGate>;
}
