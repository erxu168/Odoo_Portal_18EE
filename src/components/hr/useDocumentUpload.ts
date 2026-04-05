"use client";

import { useState } from "react";
import type { CapturedFile } from "./CapturePreview";
import compressImage from "./compressImage";

export function useDocumentUpload(docTypeKey: string, onSaved: () => void) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  async function handleSave(captures: CapturedFile[]) {
    if (captures.length === 0) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: captures.length });

    try {
      const files: { filename: string; data_base64: string }[] = [];
      for (let i = 0; i < captures.length; i++) {
        setUploadProgress({ current: i + 1, total: captures.length });
        const cap = captures[i];
        let base64: string;

        if (cap.isPdf) {
          base64 = cap.dataUrl.split(",")[1];
        } else {
          base64 = await compressImage(cap.dataUrl);
        }

        const ext = cap.isPdf ? ".pdf" : ".jpg";
        const suffix = captures.length > 1 ? `_p${i + 1}` : "";
        const filename = `${docTypeKey}_${new Date().toISOString().slice(0, 10)}${suffix}${ext}`;
        files.push({ filename, data_base64: base64 });
      }

      const res = await fetch("/api/hr/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_type_key: docTypeKey, files }),
      });

      if (res.ok) {
        onSaved();
      }
    } catch (_e: unknown) {
      console.error("Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  return { uploading, uploadProgress, handleSave };
}
