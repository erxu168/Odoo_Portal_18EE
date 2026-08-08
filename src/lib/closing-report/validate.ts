// Closing Report — pure answer validation.
//
// Turns a submitted payload + the department's active questions into snapshot
// rows, or a per-question error map. Pure (no DB, no clock) so the rules that
// decide whether a night's record is acceptable are unit-tested directly:
// every non-text question answered; an answer the manager marked as a problem
// carries a non-empty note.

export type QType = 'yes_no' | 'choice' | 'rating' | 'text';

export interface QuestionDef {
  id: number;
  position: number;
  text: string;
  qtype: QType;
  options: string[];         // choice only
  problem_values: string[];  // answer values that flag a problem
}

export interface AnswerInput {
  question_id: number;
  value?: unknown;
  note?: unknown;
}

export interface AnswerRow {
  question_id: number;
  position: number;
  question_text: string;
  qtype: QType;
  options: string[];
  problem_values: string[]; // snapshotted too, so a pre-lock correction re-validates against the night's own rules
  value: string;            // '' for an unanswered optional text question
  is_problem: boolean;
  note: string | null;
}

export const RATING_VALUES = ['1', '2', '3', '4', '5'];
export const YES_NO_VALUES = ['yes', 'no'];
export const MAX_NOTE_CHARS = 2000;
export const MAX_TEXT_ANSWER_CHARS = 2000;

function asTrimmedString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function valueAllowed(q: QuestionDef, value: string): boolean {
  switch (q.qtype) {
    case 'yes_no': return YES_NO_VALUES.includes(value);
    case 'rating': return RATING_VALUES.includes(value);
    case 'choice': return q.options.includes(value);
    case 'text': return true;
  }
}

export type ValidationResult =
  | { ok: true; rows: AnswerRow[] }
  | { ok: false; errors: Record<number, string> };

/**
 * Validate a submission against the questions it answers. `answers` may arrive
 * in any order; rows come back in question order. Unknown question ids are
 * ignored (a manager may have deleted a question mid-fill — the surviving
 * questions still validate).
 */
export function normalizeAnswers(questions: QuestionDef[], answers: AnswerInput[]): ValidationResult {
  const byId = new Map<number, AnswerInput>();
  for (const a of answers) {
    if (a && typeof a.question_id === 'number') byId.set(a.question_id, a);
  }

  const errors: Record<number, string> = {};
  const rows: AnswerRow[] = [];

  for (const q of [...questions].sort((a, b) => a.position - b.position)) {
    const input = byId.get(q.id);
    const value = asTrimmedString(input?.value, q.qtype === 'text' ? MAX_TEXT_ANSWER_CHARS : 200);
    const note = asTrimmedString(input?.note, MAX_NOTE_CHARS);

    if (q.qtype !== 'text' && !value) {
      errors[q.id] = 'Please answer this question.';
      continue;
    }
    if (value && !valueAllowed(q, value)) {
      errors[q.id] = 'That is not one of the possible answers.';
      continue;
    }

    const isProblem = !!value && q.problem_values.includes(value);
    if (isProblem && !note) {
      errors[q.id] = 'Please describe what happened — the manager needs the story, not just the answer.';
      continue;
    }

    rows.push({
      question_id: q.id,
      position: q.position,
      question_text: q.text,
      qtype: q.qtype,
      options: q.options,
      problem_values: q.problem_values,
      value,
      is_problem: isProblem,
      note: note || null,
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

/** Sanity limits for manager-authored questions. */
export const MAX_QUESTION_CHARS = 300;
export const MAX_OPTION_CHARS = 60;
export const MAX_OPTIONS = 8;
export const MAX_QUESTIONS_PER_DEPT = 30;

export type QuestionValidation =
  | { ok: true; text: string; qtype: QType; options: string[]; problem_values: string[] }
  | { ok: false; error: string };

export function validateQuestionInput(body: {
  text?: unknown; qtype?: unknown; options?: unknown; problem_values?: unknown;
}): QuestionValidation {
  const text = asTrimmedString(body.text, MAX_QUESTION_CHARS);
  if (!text) return { ok: false, error: 'The question needs some text.' };

  const qtype = body.qtype;
  if (qtype !== 'yes_no' && qtype !== 'choice' && qtype !== 'rating' && qtype !== 'text') {
    return { ok: false, error: 'Unknown answer type.' };
  }

  let options: string[] = [];
  if (qtype === 'choice') {
    const raw = Array.isArray(body.options) ? body.options : [];
    options = raw.map((o) => asTrimmedString(o, MAX_OPTION_CHARS)).filter(Boolean);
    options = Array.from(new Set(options)).slice(0, MAX_OPTIONS);
    if (options.length < 2) return { ok: false, error: 'A choose-one question needs at least two options.' };
  }

  const allowed: string[] =
    qtype === 'yes_no' ? YES_NO_VALUES :
    qtype === 'rating' ? RATING_VALUES :
    qtype === 'choice' ? options : [];
  const rawProblems = Array.isArray(body.problem_values) ? body.problem_values : [];
  const problem_values = Array.from(new Set(
    rawProblems.map((p) => asTrimmedString(p, MAX_OPTION_CHARS)).filter((p) => allowed.includes(p)),
  ));

  return { ok: true, text, qtype, options, problem_values };
}
