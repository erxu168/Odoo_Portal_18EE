"use client";

import React from "react";
import type { ExistingDoc } from "./ExistingDocsGrid";

interface DeleteDocDialogProps {
  doc: ExistingDoc;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Modal confirmation dialog for deleting an existing document */
export default function DeleteDocDialog({
  doc,
  deleting,
  error,
  onCancel,
  onConfirm,
}: DeleteDocDialogProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-6 max-w-[340px] w-full shadow-xl">
        <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-2">Delete document?</div>
        <p className="text-[var(--fs-sm)] text-gray-500 mb-1">
          <span className="font-semibold text-gray-700">{doc.name}</span>
        </p>
        <p className="text-[var(--fs-sm)] text-gray-500 mb-4">
          This will archive the file in Odoo. The change will be logged.
        </p>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-[var(--fs-xs)] text-red-700 font-semibold">{error}</p>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={deleting}
            className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl active:opacity-85 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex-1 py-3 bg-red-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40 flex items-center justify-center gap-2">
            {deleting && <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
