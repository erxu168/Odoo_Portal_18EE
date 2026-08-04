import React from 'react';

/**
 * The one thin-line icon set for interface "machinery" (home, back, close,
 * chevrons, checkmarks) — part of the portal design standard.
 *
 * Rule (docs/superpowers/specs/2026-07-21-portal-design-standard-design.md):
 * emoji carry meaning ON action cards; this single stroke-2 Feather-style set
 * runs the chrome. Never a second icon style, never emoji for chrome.
 *
 * All icons use currentColor + fill:none + round caps/joins and are aria-hidden;
 * the surrounding button owns the accessible label.
 */
export interface ChromeIconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  };
}

export function HomeIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function BackIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M15 19l-7-7 7-7" />
    </svg>
  );
}

export function CloseIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Crosshair — "show me exactly where this is" (the floorplan button on a
 *  counting spot). Chosen over a map emoji: the job is pinpointing one place,
 *  not opening an atlas. */
export function CrosshairIcon({ size = 20, className }: ChromeIconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}
