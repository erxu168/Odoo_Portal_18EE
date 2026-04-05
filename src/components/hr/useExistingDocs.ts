"use client";

import { useState, useEffect, useCallback } from "react";
import type { ExistingDoc, ThumbnailData } from "./ExistingDocsGrid";

export interface ViewerData {
  base64: string;
  mimetype: string;
  name: string;
}

export function useExistingDocs(docTypeKey: string) {
  const [existingDocs, setExistingDocs] = useState<ExistingDoc[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<number, ThumbnailData>>({});
  const [viewerData, setViewerData] = useState<ViewerData | null>(null);
  const [loadingViewerId, setLoadingViewerId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExistingDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/hr/documents")
      .then((r) => r.json())
      .then((d) => {
        const matching = (d.documents || []).filter(
          (doc: ExistingDoc) => doc.doc_type_key === docTypeKey
        );
        setExistingDocs(matching);
      })
      .catch(() => {});
  }, [docTypeKey]);

  // Fetch thumbnails for existing docs in background
  const fetchThumbnails = useCallback(async () => {
    if (existingDocs.length === 0) return;
    for (const doc of existingDocs) {
      if (thumbnails[doc.id]) continue;
      try {
        const res = await fetch("/api/hr/documents/" + doc.id);
        if (res.ok) {
          const data = await res.json();
          setThumbnails((prev) => ({
            ...prev,
            [doc.id]: { base64: data.data_base64, mimetype: data.mimetype },
          }));
        }
      } catch {
        // skip failed thumbnails
      }
    }
  }, [existingDocs, thumbnails]);

  useEffect(() => {
    fetchThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDocs]);

  async function handleViewExisting(doc: ExistingDoc) {
    const cached = thumbnails[doc.id];
    if (cached) {
      setViewerData({ base64: cached.base64, mimetype: cached.mimetype, name: doc.name });
      return;
    }

    setLoadingViewerId(doc.id);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id);
      if (res.ok) {
        const data = await res.json();
        setViewerData({
          base64: data.data_base64,
          mimetype: data.mimetype,
          name: data.name,
        });
        setThumbnails((prev) => ({
          ...prev,
          [doc.id]: { base64: data.data_base64, mimetype: data.mimetype },
        }));
      }
    } catch (_e: unknown) {
      console.error("Failed to load document");
    } finally {
      setLoadingViewerId(null);
    }
  }

  async function handleDeleteDoc(doc: ExistingDoc) {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        setExistingDocs((prev) => prev.filter((d) => d.id !== doc.id));
        setThumbnails((prev) => {
          const copy = { ...prev };
          delete copy[doc.id];
          return copy;
        });
      } else {
        const data = await res.json();
        setDeleteError(data.error || "Cannot delete this document");
      }
    } catch (_e: unknown) {
      setDeleteError("Failed to delete document");
    } finally {
      setDeleting(false);
    }
  }

  function clearDeleteTarget() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  return {
    existingDocs,
    thumbnails,
    viewerData,
    setViewerData,
    loadingViewerId,
    deleteTarget,
    setDeleteTarget,
    deleting,
    deleteError,
    handleViewExisting,
    handleDeleteDoc,
    clearDeleteTarget,
  };
}
