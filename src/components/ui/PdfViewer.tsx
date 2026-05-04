'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * PdfViewer — fullscreen modal PDF viewer for Krawings Portal PWA.
 *
 * Opens as a near-fullscreen overlay. User can scroll in all directions
 * and pinch-to-zoom. X button in top-right corner closes the viewer.
 *
 * Uses PDF.js canvas rendering (not iframe) for consistent iOS/Android behavior.
 *
 * Usage:
 *   <PdfViewer fileData={base64String} fileName="worksheet.pdf" onClose={() => setShow(false)} />
 *   <PdfViewer fileUrl="/path/to/doc.pdf" onClose={() => setShow(false)} />
 */

interface PdfViewerProps {
  fileUrl?: string;
  fileData?: string;
  fileName?: string;
  initialPage?: number;
  onClose: () => void;
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
  onClose,
}: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [rendering, setRendering] = useState(false);

  // Zoom ref to avoid stale closures in pinch handlers
  const zoomRef = useRef(1.0);
  function updateZoom(newZoom: number) {
    const clamped = Math.max(0.5, Math.min(5.0, newZoom));
    zoomRef.current = clamped;
    setZoom(clamped);
  }

  // Pinch state
  const pinchRef = useRef({ active: false, initialDist: 0, initialZoom: 1.0 });

  // Load PDF document
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
        throw new Error('No PDF source provided');
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
    } catch (err: any) {
      setError(err?.message || 'Failed to load PDF');
      setLoading(false);
    }
  }, [fileUrl, fileData, initialPage]);

  useEffect(() => {
    loadDocument();
    // Lock body scroll when modal is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
      if (pdfDocRef.current) { pdfDocRef.current.destroy(); pdfDocRef.current = null; }
    };
  }, [loadDocument]);

  // Render current page to canvas
  const renderPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      // Render at 2x for retina, scale with CSS
      const scale = zoom * 2;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / 2}px`;
      canvas.style.height = `${viewport.height / 2}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
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

  // Page navigation
  function prevPage() { setCurrentPage(p => Math.max(1, p - 1)); }
  function nextPage() { setCurrentPage(p => Math.min(totalPages, p + 1)); }

  // Pinch-to-zoom via native gesturechange (Safari) or touch events
  // Uses zoomRef to avoid stale closures; empty dependency array so listeners
  // are attached once and never torn down during a pinch gesture.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Safari gesture events (more reliable on iOS)
    function onGestureStart(e: any) {
      e.preventDefault();
      pinchRef.current = { active: true, initialDist: 0, initialZoom: zoomRef.current };
    }
    function onGestureChange(e: any) {
      e.preventDefault();
      const newZoom = pinchRef.current.initialZoom * e.scale;
      updateZoom(newZoom);
    }
    function onGestureEnd(e: any) {
      e.preventDefault();
      pinchRef.current.active = false;
    }

    // Touch events fallback (Android)
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { active: true, initialDist: Math.hypot(dx, dy), initialZoom: zoomRef.current };
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scale = dist / pinchRef.current.initialDist;
        const newZoom = pinchRef.current.initialZoom * scale;
        updateZoom(newZoom);
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchRef.current.active = false;
    }

    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Page nav */}
          <button onClick={prevPage} disabled={currentPage <= 1}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 disabled:opacity-30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="text-white/90 text-[13px] font-mono font-semibold min-w-[50px] text-center">
            {currentPage} / {totalPages}
          </span>
          <button onClick={nextPage} disabled={currentPage >= totalPages}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 disabled:opacity-30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </button>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 ml-2 border-l border-white/20 pl-3">
            <button onClick={() => updateZoom(zoom - 0.25)} disabled={zoom <= 0.5}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 disabled:opacity-30">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/></svg>
            </button>
            <span className="text-white/80 text-[12px] font-mono font-semibold min-w-[40px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={() => updateZoom(zoom + 0.25)} disabled={zoom >= 5.0}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 disabled:opacity-30">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* File name */}
          {fileName && (
            <span className="text-white/50 text-[11px] font-mono truncate max-w-[120px]">{fileName}</span>
          )}

          {/* Close button */}
          <button onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Reset zoom button — only visible when zoomed */}
      {zoom !== 1.0 && (
        <div className="flex-shrink-0 flex justify-center py-1">
          <button onClick={() => updateZoom(1.0)}
            className="px-3 py-1 rounded-full bg-white/10 text-white/60 text-[11px] font-mono active:bg-white/20 transition-colors">
            Reset to 100%
          </button>
        </div>
      )}

      {/* Scrollable canvas area — takes all remaining space */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3" />
          <div className="text-white/50 text-[13px]">Loading PDF...</div>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="text-red-400 text-[15px] font-bold mb-2">Could not load PDF</div>
          <div className="text-white/50 text-[13px] mb-4">{error}</div>
          <button onClick={loadDocument} className="px-5 py-2.5 rounded-xl bg-green-600 text-white text-[13px] font-bold">Retry</button>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
        >
          <div className="inline-block min-w-full min-h-full p-2">
            <canvas
              ref={canvasRef}
              className="block bg-white shadow-2xl mx-auto"
            />
          </div>
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
