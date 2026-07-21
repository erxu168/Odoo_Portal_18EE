import React from 'react';
import { ds } from '@/lib/design-system';

/**
 * Labelled form field wrapper (label + control + optional hint/error).
 * Promoted to ui/ in wave 0 from shift-handover/common.tsx.
 */
export interface FieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
}

export function Field({ label, children, htmlFor, hint, error, required }: FieldProps) {
  return (
    <div className={ds.fieldRow}>
      <label className={ds.label} htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[var(--fs-xs)] text-red-600 mt-1">{error}</p>
      ) : (
        hint && <p className="text-[var(--fs-xs)] text-gray-400 mt-1">{hint}</p>
      )}
    </div>
  );
}

export default Field;
