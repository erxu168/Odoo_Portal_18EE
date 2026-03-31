"use client";

import React, { useState } from "react";

interface Props {
  title: string;
  text: string;
  url?: string;
  urlLabel?: string;
}

export default function InfoButton({ title, text, url, urlLabel }: Props) {
  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen(function(prev) { return !prev; });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-[var(--fs-xs)] font-bold inline-flex items-center justify-center flex-shrink-0 active:bg-blue-600 active:text-white"
      >
        i
      </button>
    );
  }

  return (
    <span>
      <button
        type="button"
        onClick={toggle}
        className="w-5 h-5 rounded-full bg-blue-600 text-white text-[var(--fs-xs)] font-bold inline-flex items-center justify-center flex-shrink-0"
      >
        i
      </button>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-1.5 mb-3">
        <p className="text-[var(--fs-sm)] text-blue-800 leading-relaxed mb-2">
          <strong>{title}:</strong> {text}
        </p>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 font-semibold text-[var(--fs-sm)] no-underline"
          >
            {urlLabel || "Learn more"} &rarr;
          </a>
        ) : null}
      </div>
    </span>
  );
}
