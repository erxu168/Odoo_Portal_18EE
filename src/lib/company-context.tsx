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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/companies');
        const data = await res.json();
        const list: Company[] = data.companies || [];
        setCompanies(list);

        // Restore from cookie or use first company
        const saved = getCookie(COOKIE_NAME);
        const savedId = saved ? parseInt(saved, 10) : 0;
        if (savedId && list.find(c => c.id === savedId)) {
          setCompanyIdState(savedId);
        } else if (list.length > 0) {
          setCompanyIdState(list[0].id);
          setCookie(COOKIE_NAME, String(list[0].id));
        }
      } catch (e) {
        console.error('Failed to load companies:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setCompanyId = useCallback((id: number) => {
    setCompanyIdState(id);
    setCookie(COOKIE_NAME, String(id));
  }, []);

  const current = companies.find(c => c.id === companyId) || null;

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
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}
