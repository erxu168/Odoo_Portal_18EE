'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface Company {
  id: number;
  name: string;
  sequence: number;
  warehouse_id: number | null;
  warehouse_name: string | null;
  warehouse_code: string | null;
  stock_location_id: number | null;
}

interface CompanyContextValue {
  companies: Company[];
  current: Company | null;
  companyId: number;
  companyName: string;
  warehouseId: number;
  stockLocationId: number;
  warehouseCode: string;
  loading: boolean;
  setCompanyId: (id: number) => void;
  reload: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue>({
  companies: [],
  current: null,
  companyId: 0,
  companyName: '',
  warehouseId: 0,
  stockLocationId: 0,
  warehouseCode: '',
  loading: true,
  setCompanyId: () => {},
  reload: async () => {},
});

export function useCompany() {
  return useContext(CompanyContext);
}

const COOKIE_NAME = 'kw_company_id';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return;
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyIdState] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Load the companies the current user can access. Safe to call multiple times.
  // The login flow calls this right after a successful sign-in so the active
  // company is connected without needing a manual page reload.
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/companies');
      // If we're not authenticated yet (e.g. on the login screen), the request
      // is redirected to /login and returns HTML, not JSON. Ignore it — the
      // login handler will call reload() again once the session exists.
      const ctype = res.headers.get('content-type') || '';
      if (!res.ok || !ctype.includes('application/json')) return;
      const data = await res.json();
      const list: Company[] = data.companies || [];
      setCompanies(list);

      // Keep the current selection if still valid, else cookie, else first.
      const saved = getCookie(COOKIE_NAME);
      const savedId = saved ? parseInt(saved, 10) : 0;
      setCompanyIdState((prev) => {
        if (prev && list.find((c) => c.id === prev)) return prev;
        if (savedId && list.find((c) => c.id === savedId)) return savedId;
        if (list.length > 0) {
          setCookie(COOKIE_NAME, String(list[0].id));
          return list[0].id;
        }
        return 0;
      });
    } catch (e) {
      console.error('Failed to load companies:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load on mount (covers full page loads / reloads where the session
  // already exists).
  useEffect(() => {
    reload();
  }, [reload]);

  const setCompanyId = useCallback((id: number) => {
    setCompanyIdState(id);
    setCookie(COOKIE_NAME, String(id));
  }, []);

  const current = companies.find((c) => c.id === companyId) || null;

  const value: CompanyContextValue = {
    companies,
    current,
    companyId,
    companyName: current?.name || '',
    warehouseId: current?.warehouse_id || 0,
    stockLocationId: current?.stock_location_id || 0,
    warehouseCode: current?.warehouse_code || '',
    loading,
    setCompanyId,
    reload,
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}
