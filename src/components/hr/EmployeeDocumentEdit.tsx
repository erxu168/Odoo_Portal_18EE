'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import DocumentUploadWidget from '@/components/ui/DocumentUploadWidget';
import { DOCUMENT_TYPES } from '@/types/hr';

interface Props {
  employeeId: number;
  docTypeKey: string;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

interface Doc { id: number; name: string; doc_type_key: string; size_kb: number; }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Manager document editor: view + upload/replace one document type for a staff
 * member. Upload posts to /api/hr/documents, which archives (does not delete)
 * the previous file of that type and logs the change to Odoo chatter.
 */
export default function EmployeeDocumentEdit({ employeeId, docTypeKey, onBack, onDone }: Props) {
  const docType = DOCUMENT_TYPES.find((d) => d.key === docTypeKey);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hr/documents?employee_id=' + employeeId);
      const data = await res.json();
      if (res.ok) {
        const found = (data.documents || []).find((d: Doc) => d.doc_type_key === docTypeKey) || null;
        setDoc(found);
      } else {
        setError(data.error || 'Could not load documents.');
      }
    } catch {
      setError('Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, docTypeKey]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(file: File) {
    const base64 = await fileToBase64(file);
    const res = await fetch('/api/hr/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, doc_type_key: docTypeKey, filename: file.name, data_base64: base64 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Upload failed');
    }
    await load();
  }

  async function handleView() {
    if (!doc) throw new Error('No document');
    const res = await fetch('/api/hr/documents/' + doc.id);
    if (!res.ok) throw new Error('Could not open document');
    const data = await res.json();
    return { base64: data.data_base64, mimetype: data.mimetype, name: data.name || doc.name };
  }

  async function handleDelete() {
    if (!doc) return;
    const res = await fetch('/api/hr/documents/' + doc.id, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not delete this document');
    }
    await load();
  }

  if (!docType) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Document" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">Unknown document type.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={docType.label} subtitle={docType.labelDe} showBack onBack={onBack} />
      <div className="p-5 space-y-4">
        <p className="text-[var(--fs-sm)] text-gray-500">{docType.helpText}</p>

        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-[var(--fs-sm)] text-gray-500">Loading…</span>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 border border-gray-200">
            <DocumentUploadWidget
              label={docType.label}
              hasDocument={!!doc}
              documentName={doc?.name}
              onUpload={handleUpload}
              onView={handleView}
              onDelete={doc ? handleDelete : undefined}
            />
          </div>
        )}

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>
        )}

        <button onClick={onDone} className="w-full py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">
          Done
        </button>
      </div>
    </div>
  );
}
