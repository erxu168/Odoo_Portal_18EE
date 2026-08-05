import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /hr on module access — see src/lib/module-access.ts.
 * One file covers the whole folder, so a screen added here later cannot forget it.
 */
export default function HrLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={'hr'}>{children}</ModuleGate>;
}
