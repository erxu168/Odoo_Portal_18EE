import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /shifts on module access — see src/lib/module-access.ts.
 * One file covers the whole folder, so a screen added here later cannot forget it.
 */
export default function ShiftsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={'shifts'}>{children}</ModuleGate>;
}
