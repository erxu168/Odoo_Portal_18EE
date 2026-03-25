"use client";

import React, { useEffect, useState, useRef } from "react";
import type { EmployeeData } from "@/types/hr";
import { DOCUMENT_TYPES } from "@/types/hr";
import DocumentCapture from "@/components/hr/DocumentCapture";

interface Props {
  employee: EmployeeData;
  onNext: () => void;
  onPrev: () => void;
  onRefresh: () => void;
}

interface UploadedDoc {
  id: number;
  name: string;
  doc_type_key: string;
  size_kb: number;
  create_date: string;
}

export default function StepDocuments({ employee, onNext, onPrev, onRefresh }: Props) {
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDocKey, setActiveDocKey] = useState<string | null>(null);

  // Profile photo state
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDocs();
  }, []);

  useEffect(() => {
    if (employee && (employee as any).image_1920) {
      setPhotoSaved(true);
    }
  }, [employee]);

  async function loadDocs() {
    try {
      const res = await fetch("/api/hr/documents");
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents || []);
      }
    } catch (_e: unknown) {
      console.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  function getDocsForType(key: string): UploadedDoc[] {
    return docs.filter((d) => d.doc_type_key === key);
  }

  function handleDocSaved() {
    setActiveDocKey(null);
    loadDocs();
    onRefresh();
  }

  // Profile photo handlers
  function handlePhotoCapture() {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      compressToSquare(dataUrl).then((compressed) => {
        setPhotoPreview(compressed);
        uploadProfilePhoto(compressed);
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function compressToSquare(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("No canvas context")); return; }
        const srcSize = Math.min(img.width, img.height);
        const sx = (img.width - srcSize) / 2;
        const sy = (img.height - srcSize) / 2;
        ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
        const result = canvas.toDataURL("image/jpeg", 0.85);
        resolve(result);
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function uploadProfilePhoto(dataUrl: string) {
    setUploadingPhoto(true);
    try {
      const base64 = dataUrl.split(",")[1];
      const res = await fetch("/api/hr/employee", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { image_1920: base64 } }),
      });
      if (res.ok) {
        setPhotoSaved(true);
        onRefresh();
      }
    } catch (_e: unknown) {
      console.error("Failed to upload profile photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  if (activeDocKey) {
    const docType = DOCUMENT_TYPES.find((dt) => dt.key === activeDocKey);
    if (docType) {
      return (
        <DocumentCapture
          docType={docType}
          onBack={() => setActiveDocKey(null)}
          onSaved={handleDocSaved}
        />
      );
    }
  }

  const required = DOCUMENT_TYPES.filter((dt) => dt.required);
  const optional = DOCUMENT_TYPES.filter((dt) => !dt.required);

  const hasPhoto = photoPreview || photoSaved;

  return (
    <div className="pb-40">
      <div className="p-5">
        <p className="text-[13px] text-gray-500 mb-4">
          Tap each card to take photos or upload files. You can add multiple
          pages per document.
        </p>

        {/* Profile photo card */}
        <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2">
          Profile photo
        </div>
        <button
          onClick={handlePhotoCapture}
          disabled={uploadingPhoto}
          className={
            "w-full flex items-center gap-3.5 p-4 rounded-2xl border-[1.5px] text-left mb-5 transition-colors active:shadow-lg disabled:opacity-60 " +
            (hasPhoto
              ? "border-green-600 bg-green-50 border-solid"
              : "border-gray-300 bg-white border-dashed")
          }
        >
          <div
            className={
              "w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden " +
              (hasPhoto ? "bg-green-100" : "bg-gray-100")
            }
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Profile" className="w-full h-full object-cover" />
            ) : photoSaved ? (
              <img src="/api/hr/employee/photo" alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-gray-900">
              Profile Photo
            </div>
            {uploadingPhoto ? (
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-[12px] text-green-600 font-semibold">Uploading...</span>
              </div>
            ) : hasPhoto ? (
              <div className="text-[12px] text-green-600 font-semibold mt-0.5">
                Uploaded &middot; Tap to replace
              </div>
            ) : (
              <div className="text-[12px] text-gray-400 mt-0.5">
                Take a selfie or choose a photo
              </div>
            )}
          </div>
          {hasPhoto ? (
            <span className="text-green-600 text-xl flex-shrink-0">{"\u2713"}</span>
          ) : (
            <span className="text-gray-300 text-2xl flex-shrink-0">+</span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handlePhotoFile}
        />

        <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2">
          Required documents
        </div>
        {required.map((dt) => {
          const existing = getDocsForType(dt.key);
          return (
            <DocCard
              key={dt.key}
              docType={dt}
              uploadedDocs={existing}
              loading={loading}
              onTap={() => setActiveDocKey(dt.key)}
            />
          );
        })}

        <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mt-4 mb-2">
          Additional documents (if applicable)
        </div>
        {optional.map((dt) => {
          const existing = getDocsForType(dt.key);
          return (
            <DocCard
              key={dt.key}
              docType={dt}
              uploadedDocs={existing}
              loading={loading}
              onTap={() => setActiveDocKey(dt.key)}
            />
          );
        })}
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button
          onClick={onPrev}
          className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

interface DocCardProps {
  docType: (typeof DOCUMENT_TYPES)[number];
  uploadedDocs: UploadedDoc[];
  loading: boolean;
  onTap: () => void;
}

function DocCard({ docType, uploadedDocs, loading, onTap }: DocCardProps) {
  const count = uploadedDocs.length;
  const hasUploads = count > 0;

  return (
    <button
      onClick={onTap}
      disabled={loading}
      className={
        "w-full flex items-center gap-3.5 p-4 rounded-2xl border-[1.5px] text-left mb-3 transition-colors active:shadow-lg disabled:opacity-60 " +
        (hasUploads
          ? "border-green-600 bg-green-50 border-solid"
          : "border-gray-300 bg-white border-dashed")
      }
    >
      <div
        className={
          "w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0 " +
          (hasUploads ? "bg-green-100" : "bg-gray-100")
        }
      >
        {docType.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-gray-900">
            {docType.label}
          </span>
          <span className="text-[12px] text-gray-400">({docType.labelDe})</span>
        </div>
        {hasUploads ? (
          <div className="text-[12px] text-green-600 font-semibold mt-0.5">
            {count} {count === 1 ? "file" : "files"} uploaded &middot; Tap to
            view or add more
          </div>
        ) : (
          <div className="text-[12px] text-gray-400 mt-0.5">
            Tap to capture or upload
          </div>
        )}
      </div>
      {hasUploads ? (
        <span className="text-green-600 text-xl flex-shrink-0">{"\u2713"}</span>
      ) : (
        <span className="text-gray-300 text-2xl flex-shrink-0">+</span>
      )}
    </button>
  );
}
