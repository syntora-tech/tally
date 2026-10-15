'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

const noop = () => () => undefined;

export type CrumbLink = { label: string; href: string };

/**
 * Puts the current page (and the cards between it and its section) into the header breadcrumbs.
 * The header marks its slot `data-nested` only below a section's own page, so a section page does
 * not repeat its title.
 */
export function Crumb({ label, parents = [] }: { label: string; parents?: CrumbLink[] }) {
  const slot = useSyncExternalStore(
    noop,
    () => document.getElementById('v2-crumb'),
    () => null,
  );
  if (!slot || slot.dataset.nested !== 'true') return null;
  return createPortal(
    <>
      {parents.map((p) => (
        <span key={p.href} className="contents">
          <span className="text-muted-foreground" aria-hidden>
            /
          </span>
          <Link
            href={p.href}
            className="max-w-48 truncate text-muted-foreground hover:text-foreground"
          >
            {p.label}
          </Link>
        </span>
      ))}
      <span className="text-muted-foreground" aria-hidden>
        /
      </span>
      <span className="truncate font-medium" aria-current="page">
        {label}
      </span>
    </>,
    slot,
  );
}
