/**
 * task-limits.ts — size caps for Task Manager free-text fields.
 *
 * Deliberately SEPARATE from odoo-tasks.ts and free of any import: these values
 * are needed by client components (the task editor, the one-off task sheet), and
 * odoo-tasks.ts pulls in the server-only Odoo client. Importing a runtime VALUE
 * from there into a client component drags `next/headers` into the browser
 * bundle and the build fails — types alone are erased and safe, values are not.
 *
 * Each cap MUST match its Odoo-side twin, which is the real enforcement point:
 *   MAX_MANAGER_NOTE -> models/task_template_line.py MAX_MANAGER_NOTE
 * The client cap only stops the manager typing past it; the server rejects.
 */

/** Manager's standing note on a task. Bounded because it is deep-copied onto
 * every daily task line at spawn, so an unbounded value compounds day after day. */
export const MAX_MANAGER_NOTE = 1000;
