'use client';

import { useEffect } from 'react';
import type { Theme } from '@/lib/ui-prefs';

/**
 * Keeps <html class="dark"> in step with the theme after client-side updates: React leaves the
 * class alone when the server markup does not change (system ↔ light), and the inline script only
 * covers the first paint.
 */
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme !== 'system') {
      root.classList.toggle('dark', theme === 'dark');
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.classList.toggle('dark', media.matches);
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [theme]);
  return null;
}
