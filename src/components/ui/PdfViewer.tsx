'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * PdfViewer - production-ready PDF viewer for Krawings Portal PWA.
 *
 * Uses PDF.js (pdfjs-dist) for canvas-based rendering.
 * Supports: multi-page, pinch-to-zoom, pan, lazy rendering, offline (cached PDFs).
 * Works on iOS Safari + Android Chrome.
 *
 * Usage:
 *   <PdfViewer fileUrl="/path/to/doc.pdf" />
 *   <PdfViewer fileUrl={blobUrl} initialPage={3} onPageChange={p => console.log(p)} />
 *   <PdfViewer fileData={base64String} fileName="delivery_note.pdf" />
 *
 * Install: npm install pdfjs-dist
 */

interface PdfViewerProps {
  /** URL to the PDF file (http/https or blob URL) */
  fileUrl?: string;
  /** Base64-encoded PDF data (without data: prefix) */
  fileData?: string;
  /** Display name for the PDF */
  fileName?: string;
  /** Starting page number (1-indexed) */
  initialPage?: number;
  /** Initial zoom level (1.0 = 100%) */
  zoomLevel?: number;
  /** Called when page changes */
  onPageChange?: (page: number, totalPages: number) => void;
  /** Called when PDF loads successfully */
  onLoad?: (totalPages: number) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when user closes the viewer */
  onClose?: () => void;
  /** Max height of the viewer container */
  maxHeight?: string;
}

let pdfjsLib: any = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  pdfjsLib = pdfjs;
  return pdfjs;
}

export default function PdfViewer({
  fileUrl,
  fileData,
  fileName,
  initialPage = 1,
  zoomLevel: initialZoom = 1.0,
  onPageChange,
  onLoad,
  onError,
  onClose,
  maxHeight = '80vh',
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(initialZoom);
  const [rendering, setRendering] = useState(false);

  const touchStateRef = useRef({
    initialDistance: 0,
    initialZoom: 1.0,
    isPinching: false,
    lastTouchX: 0,
    lastTouchY: 0,
    scrollStartX: 0,
    scrollStartY: 0,
  });

  // Load PDF
  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pdfjs = await loadPdfJs();
      let source: any;
      if (fileData) {
        const raw = atob(fileData);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        source = { data: arr };
      } else if (fileUrl) {
        source = { url: fileUrl };
      } else {
        throw new Error('No PDF source provided (fileUrl or fileData required)');
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
      const doc = await pdfjs.getDocument(source).promise;
      pdfDocRef.current = doc;
      const pages = doc.numPages;
      setTotalPages(pages);
      setCurrentPage(Math.min(initialPage, pages));
      setLoading(false);
      onLoad?.(pages);
    } catch (err: any) {
      const msg = err?.message || 'Failed to load PDF';
      setError(msg);
      setLoading(false);
      onError?.(err instanceof Error ? err : new Error(msg));
    }
  }, [fileUrl, fileData, initialPage, onLoad, onError]);

  useEffect(() => {
    loadDocument();
    return () => {
      if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
      if (pdfDocRef.current) { pdfDocRef.current.destroy(); pdfDocRef.current = null; }
    };
  }, [loadDocument]);

  // Render page
  const renderPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom * 2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / 2}px`;
      canvas.style.height = `${viewport.height / 2}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const renderTask = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') console.error('PDF render error:', err);
    } finally {
      setRendering(false);
    }
  }, [zoom]);

  useEffect(() => {
    if (!loading && totalPages > 0) renderPage(currentPage);
  }, [currentPage, zoom, loading, totalPages, renderPage]);

  // Navigation
  function goToPage(page: number) {
    const p = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(p);
    onPageChange?.(p, totalPages);
  }
  function prevPage() { goToPage(currentPage - 1); }
  function nextPage() { goToPage(currentPage + 1); }
  function zoomIn() { setZoom(z => Math.min(z + 0.25, 4.0)); }
  function zoomOut() { setZoom(z => Math.max(z - 0.25, 0.5)); }
  function resetZoom() { setZoom(1.0); }

  // Touch gestures: pinch-to-zoom
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStateRef.current.initialDistance = Math.hypot(dx, dy);
      touchStateRef.current.initialZoom = zoom;
      touchStateRef.current.isPinching = true;
    } else if (e.touches.length === 1) {
      touchStateRef.current.lastTouchX = e.touches[0].clientX;
      touchStateRef.current.lastTouchY = e.touches[0].clientY;
    }
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (touchStateRef.current.isPinching && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / touchStateRef.current.initialDistance;
      const newZoom = Math.max(0.5, Math.min(4.0, touchStateRef.current.initialZoom * scale));
      setZoom(newZoom);
    }
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) touchStateRef.current.isPinching = false;
  }

  // Swipe to change page
  const swipeRef = useRef({ startX: 0, startY: 0, startTime: 0 });
  function handleSwipeStart(e: React.TouchEvent) {
    if (e.touches.length === 1 && zoom <= 1.0) {
      swipeRef.current.startX = e.touches[0].clientX;
      swipeRef.current.startY = e.touches[0].clientY;
      swipeRef.current.startTime = Date.now();
    }
  }
  function handleSwipeEnd(e: React.TouchEvent) {
    if (zoom > 1.0) return;
    const dx = (e.changedTouches[0]?.clientX || 0) - swipeRef.current.startX;
    const dy = (e.changedTouches[0]?.clientY || 0) - swipeRef.current.startY;
    const dt = Date.now() - swipeRef.current.startTime;
    if (Math.abs(dx) > 80 && dt < 300 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) nextPage();
      else prevPage();
    }
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
          </svg>
        </div>
        <div className="text-[15px] font-bold text-gray-900 mb-1">Could not load PDF</div>
        <div className="text-[13px] text-gray-500 mb-4">{error}</div>
        <button onClick={loadDocument} className="px-5 py-2.5 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Retry</button>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mb-3" />
        <div className="text-[13px] text-gray-500">Loading PDF...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-gray-100 rounded-xl border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} disabled={zoom <= 0.5}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 active:bg-gray-100 disabled:opacity-30">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>
          </button>
          <button onClick={resetZoom}
            className="px-2 py-1 rounded-md text-[11px] font-mono font-bold text-gray-600 active:bg-gray-100">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} disabled={zoom >= 4.0}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 active:bg-gray-100 disabled:opacity-30">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6m-3-3h6"/></svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevPage} disabled={currentPage <= 1}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 active:bg-gray-100 disabled:opacity-30">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="text-[12px] font-mono font-bold text-gray-700 min-w-[60px] text-center">
            {currentPage} / {totalPages}
          </span>
          <button onClick={nextPage} disabled={currentPage >= totalPages}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 active:bg-gray-100 disabled:opacity-30">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
        {onClose ? (
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        ) : <div className="w-8" />}
      </div>

      {/* Canvas viewport */}
      <div
        ref={containerRef}
        className="overflow-auto relative"
        style={{ maxHeight, WebkitOverflowScrolling: 'touch' }}
        onTouchStart={(e) => { handleTouchStart(e); handleSwipeStart(e); }}
        onTouchMove={handleTouchMove}
        onTouchEnd={(e) => { handleTouchEnd(e); handleSwipeEnd(e); }}
      >
        <div className="flex items-start justify-center min-h-[200px] p-2">
          <canvas
            ref={canvasRef}
            className="block shadow-lg rounded bg-white"
            style={{ touchAction: zoom > 1 ? 'none' : 'pan-y' }}
          />
        </div>
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 pointer-events-none">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* File name footer */}
      {fileName && (
        <div className="px-3 py-1.5 bg-white border-t border-gray-200 text-center">
          <span className="text-[10px] text-gray-400 font-mono truncate">{fileName}</span>
        </div>
      )}

      {/* Swipe hint */}
      {currentPage === 1 && totalPages > 1 && zoom <= 1.0 && (
        <div className="px-3 py-1.5 bg-gray-50 text-center border-t border-gray-100">
          <span className="text-[10px] text-gray-400">Swipe left for next page &middot; Pinch to zoom</span>
        </div>
      )}
    </div>
  );
}
