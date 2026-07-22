/**
 * Legacy redirect — the canonical product page moved to /products/[id] when
 * Products became its own module. A server redirect (real HTTP, no blank
 * client render, no JS dependency) keeps links shipped before the move (and any
 * bookmarks) working. Safe to delete once no old links remain.
 */
import { redirect } from 'next/navigation';

export default function LegacyProductRedirect({ params }: { params: { id: string } }) {
  redirect(`/products/${params.id}`);
}
