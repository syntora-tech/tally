'use client';

import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** A list row whose details (lines, history) unfold under it; actions stay outside the toggle. */
export function ExpandableRow({
  summary,
  actions,
  children,
  label,
  defaultOpen = false,
  testId,
}: {
  summary: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  label: string;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-testid={testId} className="border-b last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:flex-nowrap">
        <button
          type="button"
          aria-expanded={open}
          aria-label={label}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className="flex min-w-0 basis-full items-center gap-3 text-left sm:flex-1 sm:basis-auto"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          {summary}
        </button>
        {actions && (
          <div className="ml-7 flex flex-1 shrink-0 items-center justify-end gap-2 sm:ml-0 sm:flex-none">
            {actions}
          </div>
        )}
      </div>
      {open && <div className="bg-muted/40 px-3 pt-1 pb-3 sm:pl-10">{children}</div>}
    </div>
  );
}
