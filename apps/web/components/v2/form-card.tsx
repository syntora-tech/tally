'use client';

import type { ReactNode } from 'react';
import { useIsV2 } from './ui-version';

/**
 * Frame of a create/edit page in v2: the form sits in one card and its buttons become the card's
 * footer (Cancel, then the primary action on the right) — see `[data-form-card]` in globals.css.
 * In v1 it renders the form as is.
 */
export function FormCard({ children }: { children: ReactNode }) {
  if (!useIsV2()) return <>{children}</>;
  return (
    <section data-form-card className="max-w-4xl rounded-lg border bg-card px-5 py-5 md:px-6">
      {children}
    </section>
  );
}
