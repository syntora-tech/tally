'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-renders the page from the server while a background job is pending (a PDF being generated);
 * the page drops this component once the job is done, which stops the polling. Capped so a stuck
 * job does not poll forever.
 */
export function AutoRefresh({
  intervalMs = 2_000,
  maxMs = 180_000,
}: {
  intervalMs?: number;
  maxMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > maxMs) {
        clearInterval(timer);
        return;
      }
      if (!document.hidden) router.refresh();
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [router, intervalMs, maxMs]);
  return null;
}
