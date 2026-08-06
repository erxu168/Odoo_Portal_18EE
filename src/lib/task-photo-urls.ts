/**
 * Where a subtask's reference photo comes from.
 *
 * There are TWO of them, on two different Odoo models: the one a manager edits
 * on a template, and the frozen copy on a given day's list. They are served by
 * different routes, and an id from one means nothing to the other.
 *
 * This exists because a component built the daily URL out of whatever ids it was
 * handed, and the manager's preview hands it FABRICATED NEGATIVE ids (so they can
 * never collide with a real day). The request went to the daily route with a
 * negative id, Odoo found nothing, and the 404 landed in an <img> as a broken
 * icon. Whoever owns the ids must say which photo they mean — that is the only
 * thing that makes the two impossible to confuse.
 *
 * Deliberately free of imports so client components can use it.
 */

/** The frozen copy on one day's task list. */
export function dailySubtaskPhotoUrl(lineId: number, subtaskId: number): string {
  return `/api/tasks/lines/${lineId}/subtasks/${subtaskId}/photo`;
}

/** The original, on the template a manager edits. */
export function templateSubtaskPhotoUrl(templateId: number, lineId: number, subtaskId: number): string {
  return `/api/tasks/templates/${templateId}/lines/${lineId}/subtasks/${subtaskId}/photo`;
}
