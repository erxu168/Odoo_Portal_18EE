"use client";

import React, { useCallback, useRef } from "react";

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
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (disabled || loading) return;
    inputRef.current?.click();
  }, [disabled, loading]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        onFile(file, dataUrl);
      };
      reader.readAsDataURL(file);
      // Reset so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFile]
  );

  const sizeH =
    size === "sm" ? "h-28" : size === "lg" ? "h-48" : "h-40";

  if (variant === "button") {
    return (
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
    return (
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

  // Default: slot variant (tall dashed box)
  return (
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
