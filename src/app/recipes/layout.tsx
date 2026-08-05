import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /recipes on module access — see src/lib/module-access.ts.
 * One file covers the whole folder, so a screen added here later cannot forget it.
 */
export default function RecipesLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId={['recipes', 'production-guide']}>{children}</ModuleGate>;
}
