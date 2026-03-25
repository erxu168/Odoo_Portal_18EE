"use client";

import { useState, useEffect, useCallback } from "react";

const CACHE_PREFIX = "kw_hr_";

export function useFormCache<T extends Record<string, unknown>>(
  stepKey: string,
  defaults: T
): [T, (updates: Partial<T>) => void, () => void] {
  const cacheKey = CACHE_PREFIX + stepKey;

  const [values, setValues] = useState<T>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as Partial<T>;
        return { ...defaults, ...parsed };
      }
    } catch (_e) {
      // ignore
    }
    return defaults;
  });

  useEffect(() => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(values));
    } catch (_e) {
      // ignore
    }
  }, [values, cacheKey]);

  const updateValues = useCallback((updates: Partial<T>) => {
    setValues((prev) => ({ ...prev, ...updates }));
  }, []);

  const clearCache = useCallback(() => {
    try {
      localStorage.removeItem(cacheKey);
    } catch (_e) {
      // ignore
    }
  }, [cacheKey]);

  return [values, updateValues, clearCache];
}

export function clearAllHrCache(): void {
  if (typeof window === "undefined") return;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
