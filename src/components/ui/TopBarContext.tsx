'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface TopBarContextType {
  hidden: boolean;
  setHidden: (v: boolean) => void;
}

const TopBarContext = createContext<TopBarContextType>({ hidden: false, setHidden: () => {} });

export function TopBarProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHiddenState] = useState(false);
  const setHidden = useCallback((v: boolean) => setHiddenState(v), []);
  return (
    <TopBarContext.Provider value={{ hidden, setHidden }}>
      {children}
    </TopBarContext.Provider>
  );
}

export function useTopBar() {
  return useContext(TopBarContext);
}
