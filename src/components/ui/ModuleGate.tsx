import Link from 'next/link';
import { redirect } from 'next/navigation';
import { checkModuleAccess } from '@/lib/module-access';

/**
 * Server-side page gate for a whole module.
 *
 * Drop it in a module's `layout.tsx` and every page underneath is covered —
 * one file protects the whole folder, so a new screen added later cannot
 * forget the guard:
 *
 *   // src/app/rentals/layout.tsx
 *   export default function RentalsLayout({ children }) {
 *     return <ModuleGate moduleId="rentals">{children}</ModuleGate>;
 *   }
 *
 * Blocked users get an explanation and a way out rather than a silent bounce
 * to Home — a block with no reason and no next step reads as a broken app
 * (Design Principle 6).
 *
 * `moduleId` must be an id from src/lib/modules.ts. Unknown ids deny access.
 */
export default function ModuleGate({
  moduleId,
  children,
}: {
  /** One module id, or several when ANY of them grants entry (e.g. /recipes). */
  moduleId: string | string[];
  children: React.ReactNode;
}) {
  const result = checkModuleAccess(moduleId);

  if (!result.ok && result.reason === 'unauthenticated') redirect('/login');

  if (!result.ok) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-5">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-2">
            You don&rsquo;t have access to this
          </h1>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-6">
            This part of the portal isn&rsquo;t switched on for your account. If you
            need it for your work, ask your manager to turn it on for you.
          </p>
          <Link
            href="/"
            className="block w-full bg-[#16A34A] text-white font-semibold rounded-xl py-3 active:scale-[0.98] transition-transform"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
