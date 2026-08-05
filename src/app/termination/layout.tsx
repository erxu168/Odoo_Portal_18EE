import ModuleGate from '@/components/ui/ModuleGate';

/**
 * Gates every page under /termination on module access.
 *
 * The registry points the Termination tile at /hr/termination, but that page is
 * only a redirect stub — the real screens live here, so this is where the gate
 * has to be. Gating the stub alone protected nothing.
 */
export default function TerminationLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate moduleId="termination">{children}</ModuleGate>;
}
