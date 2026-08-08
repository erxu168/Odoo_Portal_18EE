import { test, expect } from '@playwright/test';
import {
  shiftDay, operationalDateFor, isWithinEditWindow, NIGHT_CUTOFF_HOUR,
} from '../src/lib/closing-report/night';
import {
  normalizeAnswers, validateQuestionInput, type QuestionDef,
} from '../src/lib/closing-report/validate';

// ---------------------------------------------------------------------------
// The night boundary
// ---------------------------------------------------------------------------

test('shiftDay crosses month and year boundaries', () => {
  expect(shiftDay('2026-08-01', -1)).toBe('2026-07-31');
  expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
});

test('a close after midnight belongs to the previous evening', () => {
  expect(operationalDateFor('2026-08-08', 23)).toBe('2026-08-08'); // 23:00 → tonight
  expect(operationalDateFor('2026-08-09', 0)).toBe('2026-08-08');  // 00:30 → still last night
  expect(operationalDateFor('2026-08-09', 4)).toBe('2026-08-08');  // 04:59 → still last night
  expect(operationalDateFor('2026-08-09', NIGHT_CUTOFF_HOUR)).toBe('2026-08-09'); // 05:00 → new day
});

test('the edit window closes at 05:00 the next morning', () => {
  const night = '2026-08-08';
  expect(isWithinEditWindow(night, '2026-08-08', 22)).toBe(true);  // same evening
  expect(isWithinEditWindow(night, '2026-08-09', 1)).toBe(true);   // after midnight, before 05:00
  expect(isWithinEditWindow(night, '2026-08-09', 5)).toBe(false);  // locked
  expect(isWithinEditWindow(night, '2026-08-10', 12)).toBe(false); // days later
});

// ---------------------------------------------------------------------------
// Answer validation
// ---------------------------------------------------------------------------

const QUESTIONS: QuestionDef[] = [
  { id: 1, position: 1, text: 'Is all equipment working?', qtype: 'yes_no', options: [], problem_values: ['no'] },
  { id: 2, position: 2, text: 'How busy was tonight?', qtype: 'choice', options: ['Quiet', 'Normal', 'Busy'], problem_values: [] },
  { id: 3, position: 3, text: 'How did the team run?', qtype: 'rating', options: [], problem_values: [] },
  { id: 4, position: 4, text: 'Anything for the morning team?', qtype: 'text', options: [], problem_values: [] },
];

const FULL_ANSWERS = [
  { question_id: 1, value: 'yes' },
  { question_id: 2, value: 'Busy' },
  { question_id: 3, value: '4' },
];

test('a complete submission normalizes into snapshot rows in question order', () => {
  const res = normalizeAnswers(QUESTIONS, [...FULL_ANSWERS].reverse());
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.rows.map((r) => r.question_id)).toEqual([1, 2, 3, 4]);
  expect(res.rows[0].question_text).toBe('Is all equipment working?');
  expect(res.rows.every((r) => !r.is_problem)).toBe(true);
});

test('the optional text question may stay empty; the others may not', () => {
  const missing = normalizeAnswers(QUESTIONS, FULL_ANSWERS.slice(0, 2));
  expect(missing.ok).toBe(false);
  if (missing.ok) return;
  expect(missing.errors[3]).toBeTruthy(); // rating unanswered
  expect(missing.errors[4]).toBeUndefined(); // text is optional
});

test('an answer outside the allowed values is rejected', () => {
  const res = normalizeAnswers(QUESTIONS, [
    { question_id: 1, value: 'maybe' },
    { question_id: 2, value: 'Slammed' }, // not one of this question's options
    { question_id: 3, value: '7' },
  ]);
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(Object.keys(res.errors).map(Number).sort()).toEqual([1, 2, 3]);
});

test('a problem answer requires a note; with the note it flags', () => {
  const withoutNote = normalizeAnswers(QUESTIONS, [
    { question_id: 1, value: 'no' }, ...FULL_ANSWERS.slice(1),
  ]);
  expect(withoutNote.ok).toBe(false);
  if (!withoutNote.ok) expect(withoutNote.errors[1]).toContain('describe');

  const withNote = normalizeAnswers(QUESTIONS, [
    { question_id: 1, value: 'no', note: 'Freezer door seal is broken' }, ...FULL_ANSWERS.slice(1),
  ]);
  expect(withNote.ok).toBe(true);
  if (!withNote.ok) return;
  expect(withNote.rows[0].is_problem).toBe(true);
  expect(withNote.rows[0].note).toBe('Freezer door seal is broken');
});

test('answers to questions that no longer exist are ignored', () => {
  const res = normalizeAnswers(QUESTIONS, [...FULL_ANSWERS, { question_id: 999, value: 'yes' }]);
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.rows.some((r) => r.question_id === 999)).toBe(false);
});

// ---------------------------------------------------------------------------
// Question builder validation
// ---------------------------------------------------------------------------

test('a choose-one question needs at least two distinct options', () => {
  expect(validateQuestionInput({ text: 'Busy?', qtype: 'choice', options: ['Yes'] }).ok).toBe(false);
  expect(validateQuestionInput({ text: 'Busy?', qtype: 'choice', options: ['Yes', 'Yes', ' '] }).ok).toBe(false);
  const ok = validateQuestionInput({ text: 'Busy?', qtype: 'choice', options: ['Quiet', 'Busy'] });
  expect(ok.ok).toBe(true);
});

test('problem values are kept only when they are answers the question can produce', () => {
  const res = validateQuestionInput({
    text: 'Equipment OK?', qtype: 'yes_no', problem_values: ['no', 'banana', 'no'],
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.problem_values).toEqual(['no']);
});

test('a rating question accepts flags only from 1–5', () => {
  const res = validateQuestionInput({ text: 'Team?', qtype: 'rating', problem_values: ['1', '9'] });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.problem_values).toEqual(['1']);
});
