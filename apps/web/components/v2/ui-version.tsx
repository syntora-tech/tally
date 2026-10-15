'use client';

import { createContext, useContext, type ReactNode } from 'react';

const UiVersion = createContext<'v1' | 'v2'>('v1');

/** Lets shared client components (tables, forms) take their v2 look; absent in v1. */
export function UiVersionProvider({ children }: { children: ReactNode }) {
  return <UiVersion.Provider value="v2">{children}</UiVersion.Provider>;
}

export function useIsV2() {
  return useContext(UiVersion) === 'v2';
}
