import { redirect } from 'next/navigation';

/**
 * RETIRED — the cross-module "Lists & Options" card was replaced by per-module
 * Settings (editable lists now live inside the module they configure: Inventory
 * ⚙ / Purchase settings). There is no single destination for the old central
 * page, so an old bookmark just goes home. Kept as a redirect for one release,
 * then this directory can be deleted.
 */
export default function RetiredListsSettings() {
  redirect('/');
}
