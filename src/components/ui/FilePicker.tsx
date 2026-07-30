"use client";

import React, { useCallback, useEffect, useRef } from "react";
import DropZone from "./DropZone";

/**
 * FilePicker — Shared upload widget for the Krawings Portal.
 *
 * Usage:
 *   <FilePicker onFile={(file, dataUrl) => handleFile(file, dataUrl)} />
 *   <FilePicker onFile={handler} accept="image/*" label="Take or choose photo" />
 *   <FilePicker onFile={handler} accept="image/*,.pdf" icon="+" size="lg" />
 *
 * On mobile: tapping opens the native OS picker with options:
 *   - Take Photo (camera)
 *   - Choose from Gallery
 *   - Browse Files
 * No `capture` attribute is set, so all three options appear natively.
 *
 * DRAG AND DROP is built in, not per screen. Ethan's standing rule: "any place
 * you can add a photo or file, you must also be able to drag one in — that should
 * be the general rule." Wrapping the whole picker in ui/DropZone means all seven
 * screens that already use this get it with no change at their call site, and no
 * screen can accidentally ship a photo box that ignores a dropped file. PASTE is
 * opt-in (`paste`) because a document-level listener in a component used seven
 * times over would fight with itself.
 *
 * Props:
 *   onFile(file, dataUrl) — called after user picks a file; receives File + base64 dataUrl
 *   accept — file types (default: "image/*,.pdf")
 *   label — button text (default: "Tap to add")
 *   icon — icon/emoji shown above label (default: camera emoji)
 *   disabled — disable the picker
 *   loading — show spinner instead of icon
 *   className — override container classes
 *   variant — "slot" (tall dashed box) | "button" (compact green button) | "icon" (icon only)
 *   size — "sm" | "md" | "lg" (affects slot height)
 *   children — fully custom trigger content (overrides icon + label)
 */

interface FilePickerProps {
  onFile: (file: File, dataUrl: string) => void;
  accept?: string;
  label?: string;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  variant?: "slot" | "button" | "icon";
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
  /**
   * Also accept Cmd/Ctrl-V while this picker has focus. Off by default: a
   * document-level paste listener from seven simultaneous pickers is a fight
   * nobody wins. Turn it on where the screen is about one file at a time.
   */
  paste?: boolean;
}

export default function FilePicker({
  onFile,
  accept = "image/*,.pdf",
  label = "Tap to add",
  icon = "\u{1F4F7}",
  disabled = false,
  loading = false,
  className,
  variant = "slot",
  size = "md",
  children,
  paste = false,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);

  /** One path in for every source — picker, drop, paste — so they cannot drift. */
  const acceptFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => onFile(file, reader.result as string);
    reader.readAsDataURL(file);
  }, [onFile]);

  // Paste, when asked for and when this picker is the focused thing. Scoped to
  // the host element rather than the document so two pickers cannot both claim
  // the same keystroke.
  useEffect(() => {
    if (!paste || disabled || loading) return;
    const host = hostRef.current;
    if (!host) return;
    const onPaste = (e: ClipboardEvent) => {
      if (!host.contains(document.activeElement)) return;
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.kind === 'file');
      const f = item?.getAsFile();
      if (f) { e.preventDefault(); acceptFile(f); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [paste, disabled, loading, acceptFile]);

  const handleClick = useCallback(() => {
    if (disabled || loading) return;
    inputRef.current?.click();
  }, [disabled, loading]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      acceptFile(file);
      // Reset so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    },
    [acceptFile]
  );

  const sizeH =
    size === "sm" ? "h-28" : size === "lg" ? "h-48" : "h-40";

  /**
   * The drop wrapper every variant shares. A <span> host so wrapping a "button"
   * or "icon" variant cannot break an inline layout, and so the paste listener
   * above has an element to scope itself to.
   */
  const withDrop = (inner: React.ReactNode) => (
    <DropZone
      onFiles={(files) => { if (files[0]) acceptFile(files[0]); }}
      accept={accept.startsWith("image") ? "image/" : ""}
      disabled={disabled || loading}
      // NOT "contents": DropZone's root is the `relative` ancestor its drag-over
      // overlay positions against, and display:contents removes an element from
      // the box tree — the overlay would then anchor to some outer container and
      // land in the wrong place. A full-width block for the tall slot, inline for
      // the button and icon variants so they stay in their row.
      className={variant === "slot" ? "w-full" : "inline-flex"}
    >
      <span ref={hostRef} className="contents">{inner}</span>
    </DropZone>
  );

  if (variant === "button") {
    return withDrop(
      <>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        <button
          onClick={handleClick}
          disabled={disabled || loading}
          className={
            className ||
            "px-4 py-3 bg-green-600 text-white font-semibold rounded-xl text-[14px] active:opacity-85 disabled:opacity-40 flex items-center gap-2"
          }
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <span>{icon}</span>
          )}
          <span>{label}</span>
        </button>
      </>
    );
  }

  if (variant === "icon") {
    return withDrop(
      <>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        <button
          onClick={handleClick}
          disabled={disabled || loading}
          className={
            className ||
            "w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center text-[18px] active:opacity-85 disabled:opacity-40"
          }
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            icon
          )}
        </button>
      </>
    );
  }

  // Default: slot variant (tall dashed box) — the one that most looks like it
  // should accept a drop, and until now did not.
  return withDrop(
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
      <button
        onClick={handleClick}
        disabled={disabled || loading}
        className={
          className ||
          `w-full ${sizeH} border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center gap-2 bg-white active:bg-gray-50 disabled:opacity-40`
        }
      >
        {children || (
          <>
            {loading ? (
              <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[24px]">
                {icon}
              </div>
            )}
            <span className="text-[13px] text-gray-500 font-medium">
              {label}
            </span>
          </>
        )}
      </button>
    </>
  );
}
