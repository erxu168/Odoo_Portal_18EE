'use client';

// Read-only rendering of a submitted closing report: flagged problems first
// (red, with note + photos), then the ordinary answers. Used by the staff
// read view, the manager review cards, and the canonical report page.
import React from 'react';
import { type ApiAnswer, type ApiReport, answerLabel } from './common';

export default function ReportView({ report, problemExtra }: {
  report: ApiReport;
  /** Optional per-problem action slot (the manager's "Create task" button). */
  problemExtra?: (answer: ApiAnswer) => React.ReactNode;
}) {
  const problems = report.answers.filter((a) => a.is_problem);
  const normal = report.answers.filter((a) => !a.is_problem);
  const textAnswers = normal.filter((a) => a.qtype === 'text' && a.value);
  const plain = normal.filter((a) => !(a.qtype === 'text' && a.value));

  return (
    <div className="space-y-3">
      {problems.map((a) => (
        <div key={a.id} className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-center gap-2 text-red-600 text-[13px] font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" aria-hidden />
            <span className="min-w-0">{a.question_text} — {answerLabel(a)}</span>
          </div>
          {a.note && (
            <p className="text-[14px] text-gray-800 mt-2 leading-snug">“{a.note}”</p>
          )}
          {a.photos.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto">
              {a.photos.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt="Problem photo" className="w-24 h-16 object-cover rounded-lg border border-red-200 flex-shrink-0" />
              ))}
            </div>
          )}
          {problemExtra?.(a)}
        </div>
      ))}

      {plain.length > 0 && (
        <div className="divide-y divide-gray-100">
          {plain.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 py-2.5">
              <span className="text-[13.5px] text-gray-500 min-w-0">{a.question_text}</span>
              <span className={`text-[13.5px] font-bold text-right flex-shrink-0 ${
                a.qtype === 'yes_no' ? (a.value === 'yes' ? 'text-green-700' : 'text-gray-800') : 'text-gray-800'
              }`}>
                {a.qtype === 'text' && !a.value ? '—' : answerLabel(a)}
              </span>
            </div>
          ))}
        </div>
      )}

      {textAnswers.map((a) => (
        <div key={a.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{a.question_text}</p>
          <p className="text-[14px] text-gray-800 mt-1 leading-snug whitespace-pre-wrap">“{a.value}”</p>
        </div>
      ))}
    </div>
  );
}
