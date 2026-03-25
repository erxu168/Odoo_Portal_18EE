"use client";

import React, { useState } from "react";
import UploadWidget from "@/components/ui/UploadWidget";

/**
 * Expandable info card for "Rote Karte" (Gesundheitszeugnis / Food Hygiene
 * Certificate). Includes embedded upload button.
 */

interface Props {
  /** Opens DocumentCapture for gesundheitszeugnis */
  onUpload?: () => void;
  /** Number of currently uploaded files for this doc type */
  uploadedCount?: number;
}

export default function RoteKarteInfo({ onUpload, uploadedCount = 0 }: Props) {
  const [expanded, setExpanded] = useState(false);

  const hasUpload = uploadedCount > 0;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 mb-3 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left active:bg-amber-100 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[20px]">{"\ud83d\udfe5"}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-gray-900">
            Rote Karte{" "}
            <span className="font-normal text-gray-500">
              — Food Hygiene Certificate
            </span>
          </div>
          <div className="text-[12px] mt-0.5">
            {hasUpload ? (
              <span className="text-green-600 font-semibold">
                {uploadedCount} {uploadedCount === 1 ? "file" : "files"} uploaded &middot; Tap for info
              </span>
            ) : (
              <span className="text-amber-700">
                Required by law (IfSG §43) &middot; Tap for info
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasUpload && (
            <span className="text-green-600 text-lg">{"\u2713"}</span>
          )}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={
              "text-amber-600 transition-transform duration-200 " +
              (expanded ? "rotate-180" : "")
            }
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-amber-200">
          <div className="mt-3 space-y-3">
            {/* What is it */}
            <div>
              <h4 className="text-[13px] font-bold text-gray-900 mb-1">
                What is the Rote Karte?
              </h4>
              <p className="text-[13px] text-gray-600 leading-relaxed">
                The <strong>Rote Karte</strong> (red card) is a food hygiene
                certificate you receive after completing an official health
                briefing (<em>Belehrung</em>) under §43 of the German Infection
                Protection Act (<em>Infektionsschutzgesetz</em>). It proves you
                understand food safety rules and are fit to work with food.
              </p>
            </div>

            {/* How to get it */}
            <div>
              <h4 className="text-[13px] font-bold text-gray-900 mb-1">
                How do I get it?
              </h4>
              <ul className="text-[13px] text-gray-600 leading-relaxed space-y-1">
                <li className="flex gap-2">
                  <span className="text-amber-600 flex-shrink-0">1.</span>
                  <span>
                    Book an appointment at your local{" "}
                    <strong>Gesundheitsamt</strong> (public health office) — or
                    attend an online briefing if available
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-amber-600 flex-shrink-0">2.</span>
                  <span>
                    Attend the ~30 min briefing about food hygiene and infection
                    prevention
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-amber-600 flex-shrink-0">3.</span>
                  <span>
                    Receive your certificate (the red card) — valid immediately
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-amber-600 flex-shrink-0">4.</span>
                  <span>
                    Upload a photo of it below. Your employer must keep it on file
                  </span>
                </li>
              </ul>
            </div>

            {/* Cost and timing */}
            <div className="flex gap-4">
              <div className="flex-1 bg-white rounded-xl p-3 border border-amber-200">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Cost</div>
                <div className="text-[14px] font-bold text-gray-900 mt-0.5">~25 &euro;</div>
                <div className="text-[11px] text-gray-500">Varies by city</div>
              </div>
              <div className="flex-1 bg-white rounded-xl p-3 border border-amber-200">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Duration</div>
                <div className="text-[14px] font-bold text-gray-900 mt-0.5">~30 min</div>
                <div className="text-[11px] text-gray-500">Briefing session</div>
              </div>
              <div className="flex-1 bg-white rounded-xl p-3 border border-amber-200">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Valid for</div>
                <div className="text-[14px] font-bold text-gray-900 mt-0.5">Lifetime</div>
                <div className="text-[11px] text-gray-500">No renewal needed</div>
              </div>
            </div>

            {/* Important note */}
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-[12px] text-red-800 leading-relaxed">
                <strong>Important:</strong> You must get the certificate{" "}
                <strong>before</strong> your first day of work. Working with
                food without it is illegal and can result in fines for both you
                and your employer.
              </p>
            </div>

            {/* Upload section */}
            {onUpload && (
              <div>
                <h4 className="text-[13px] font-bold text-gray-900 mb-2">
                  Upload your Rote Karte
                </h4>
                <button
                  onClick={onUpload}
                  className={
                    "w-full flex items-center gap-3 p-3.5 rounded-xl border-[1.5px] text-left active:shadow-lg transition-colors " +
                    (hasUpload
                      ? "border-green-600 bg-green-50"
                      : "border-amber-400 bg-white border-dashed")
                  }
                >
                  <div className={"w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 " + (hasUpload ? "bg-green-100" : "bg-amber-100")}>
                    {hasUpload ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1">
                    {hasUpload ? (
                      <>
                        <div className="text-[13px] font-semibold text-green-700">
                          {uploadedCount} {uploadedCount === 1 ? "file" : "files"} uploaded
                        </div>
                        <div className="text-[11px] text-green-600 mt-0.5">Tap to view, replace, or add more</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[13px] font-semibold text-gray-900">Tap to upload</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">Take a photo or choose a file</div>
                      </>
                    )}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 flex-shrink-0">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
            )}

            {/* Links */}
            <div>
              <h4 className="text-[13px] font-bold text-gray-900 mb-2">
                Helpful links
              </h4>
              <div className="space-y-2">
                <InfoLink
                  href="https://service.berlin.de/dienstleistung/324280/"
                  title="Book appointment (Berlin)"
                  subtitle="Berlin.de — Gesundheitsamt Belehrung"
                />
                <InfoLink
                  href="https://allaboutberlin.com/guides/gesundheitszeugnis"
                  title="Complete guide for expats"
                  subtitle="All About Berlin — Gesundheitszeugnis explained"
                />
                <InfoLink
                  href="https://www.gesetze-im-internet.de/ifsg/__43.html"
                  title="Legal basis (IfSG §43)"
                  subtitle="Gesetze-im-Internet.de — Official law text"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoLink({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-xl active:bg-gray-50 no-underline">
      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-blue-700">{title}</div>
        <div className="text-[11px] text-gray-400 truncate">{subtitle}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 flex-shrink-0">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </a>
  );
}
