import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /tasks on module access — see src/lib/module-access.ts.
 * ModuleGate also covers the logged-out case (redirects to /login).
 */
export default function TasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleGate moduleId="tasks">
      <div className="tasks-shell min-h-screen bg-gray-50">
        {children}
      </div>
    </ModuleGate>
  );
}
