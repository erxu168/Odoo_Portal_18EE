"use client";

import React, { useRef } from "react";

/**
 * Reusable dual-button upload widget (Take Photo + Choose Files).
 *
 * Usage:
 *   <UploadWidget onFiles={(files) => handleFiles(files)} />
 *   <UploadWidget onFiles={fn} capture="user" compact />
 */

interface UploadWidgetProps {
  /** Called with selected File objects */
  onFiles: (files: File[]) => void;
  /** Camera capture mode: 'environment' (back) or 'user' (front/selfie). Default: 'environment' */
  capture?: "user" | "environment";
  /** File accept string. Default: 'image/*,.pdf,application/pdf' */
  accept?: string;
  /** Allow multiple file selection from picker. Default: true */
  multiple?: boolean;
  /** Disable both buttons */
  disabled?: boolean;
  /** Compact size for embedding inside cards */
  compact?: boolean;
  /** Custom labels */
  cameraLabel?: string;
  fileLabel?: string;
}

export default function UploadWidget({
  onFiles,
  capture = "environment",
  accept = "image/*,.pdf,application/pdf",
  multiple = true,
  disabled = false,
  compact = false,
  cameraLabel,
  fileLabel,
}: UploadWidgetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleCameraChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFiles([file]);
    e.target.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const arr: File[] = [];
    for (let i = 0; i < fileList.length; i++) arr.push(fileList[i]);
    onFiles(arr);
    e.target.value = "";
  }

  const py = compact ? "py-2.5" : "py-4";
  const iconSize = compact ? 18 : 22;
  const textSize = compact ? "text-[12px]" : "text-[14px]";
  const borderRadius = compact ? "rounded-xl" : "rounded-2xl";

  return (
    <>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-2 ${py} bg-white border-[1.5px] border-gray-200 ${borderRadius} active:bg-gray-50 active:shadow-lg transition-all disabled:opacity-40`}
        >
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-green-600"
          >
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className={`${textSize} font-semibold text-gray-900`}>
            {cameraLabel || "Take Photo"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-2 ${py} bg-white border-[1.5px] border-gray-200 ${borderRadius} active:bg-gray-50 active:shadow-lg transition-all disabled:opacity-40`}
        >
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-green-600"
          >
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span className={`${textSize} font-semibold text-gray-900`}>
            {fileLabel || "Choose Files"}
          </span>
        </button>
      </div>

      {/* Hidden inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept={accept.replace(/,\.pdf.*|,application\/pdf.*/g, capture === "user" ? "" : "$&")}
        capture={capture}
        className="hidden"
        onChange={handleCameraChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
}
