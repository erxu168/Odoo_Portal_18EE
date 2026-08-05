import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /purchase on module access — see src/lib/module-access.ts.
 * One file covers the whole folder, so a screen added here later cannot forget it.
 */
export default function PurchaseLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={'purchase'}>{children}</ModuleGate>;
}
