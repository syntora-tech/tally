'use client';

import { cn } from 'cn';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Popover } from '@base-ui/react/popover';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/lib/format';

export type FilterField =
  | {
      kind: 'select';
      name: string;
      label: string;
      allLabel: string;
      options: { value: string; label: string }[];
    }
  | { kind: 'date'; name: string; label: string }
  | {
      kind: 'text';
      name: string;
      label: string;
      placeholder?: string;
      inputMode?: 'decimal';
      /** The main search of the page: wider, with a magnifier. */
      search?: boolean;
    }
  | {
      kind: 'range';
      from: string;
      to: string;
      label: string;
      /** Quick choices, e.g. this month; dates as YYYY-MM-DD. */
      presets: { label: string; from: string; to: string }[];
      fromLabel: string;
      toLabel: string;
    }
  | { kind: 'toggle'; name: string; label: string };

/**
 * Filters that apply as soon as they change (text ones on Enter or leaving the field): each one
 * rewrites its query parameter. Parameters named in `resets` (e.g. a page size) go back to default.
 */
export function AutoFilters({
  fields,
  more = [],
  moreLabel,
  label,
  clearLabel,
  resets = [],
}: {
  fields: FilterField[];
  /** Rarely used filters, folded behind a "More filters" button (open while one is set). */
  more?: FilterField[];
  moreLabel?: string;
  label: string;
  clearLabel: string;
  resets?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const fmt = useFormat();
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    for (const k of resets) next.delete(k);
    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };
  const all = [...fields, ...more];
  const names = (f: FilterField) => (f.kind === 'range' ? [f.from, f.to] : [f.name]);
  const isSet = (f: FilterField) => names(f).some((n) => params.get(n));
  const active = all.some(isSet);
  const moreActive = more.filter(isSet).length;
  const [showMore, setShowMore] = useState(moreActive > 0);
  const control =
    'h-9 rounded-full border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending}
      className={cn('flex flex-wrap items-center gap-2', pending && 'opacity-70')}
    >
      {[...fields, ...(showMore ? more : [])].map((f) => {
        if (f.kind === 'range') {
          const from = params.get(f.from) ?? '';
          const to = params.get(f.to) ?? '';
          const on = Boolean(from || to);
          return (
            <Popover.Root key={f.from}>
              <Popover.Trigger
                className={cn(
                  control,
                  'inline-flex items-center gap-1.5 font-medium',
                  on && 'border-foreground',
                )}
              >
                {on ? `${from ? fmt.date(from) : '…'} – ${to ? fmt.date(to) : '…'}` : f.label}
                <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6} align="start" className="isolate z-50">
                  <Popover.Popup className="flex w-72 flex-col gap-3 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none">
                    <div className="flex flex-wrap gap-1.5">
                      {f.presets.map((p) => (
                        <Popover.Close
                          key={p.label}
                          onClick={() => {
                            set({ [f.from]: p.from, [f.to]: p.to });
                          }}
                          className={cn(
                            'h-8 rounded-full border px-3 text-[13px] font-medium hover:bg-muted',
                            from === p.from && to === p.to && 'border-foreground',
                          )}
                        >
                          {p.label}
                        </Popover.Close>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          [f.from, f.fromLabel, from],
                          [f.to, f.toLabel, to],
                        ] as const
                      ).map(([name, label, value]) => (
                        <label
                          key={name}
                          className="flex flex-col gap-1 text-xs text-muted-foreground"
                        >
                          {label}
                          <input
                            type="date"
                            aria-label={label}
                            value={value}
                            onChange={(e) => {
                              set({ [name]: e.target.value });
                            }}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          />
                        </label>
                      ))}
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          );
        }
        const value = params.get(f.name) ?? '';
        if (f.kind === 'toggle') {
          const on = value === 'on';
          return (
            <button
              key={f.name}
              type="button"
              aria-pressed={on}
              onClick={() => {
                set({ [f.name]: on ? '' : 'on' });
              }}
              className={cn(
                control,
                'font-medium',
                on && 'border-foreground bg-foreground text-background',
              )}
            >
              {f.label}
            </button>
          );
        }
        if (f.kind === 'text') {
          const input = (
            <input
              key={`${f.name}:${value}`}
              type="search"
              aria-label={f.label}
              placeholder={f.placeholder ?? f.label}
              inputMode={f.inputMode}
              defaultValue={value}
              onKeyDown={(e) => {
                if (e.key === 'Enter') set({ [f.name]: e.currentTarget.value.trim() });
              }}
              onBlur={(e) => {
                if (e.currentTarget.value.trim() !== value) {
                  set({ [f.name]: e.currentTarget.value.trim() });
                }
              }}
              className={cn(
                control,
                f.search ? 'w-full pl-9 sm:w-72' : 'w-40',
                value && 'border-foreground',
              )}
            />
          );
          if (f.search) {
            return (
              <span key={`${f.name}:${value}`} className="relative w-full sm:w-auto">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                {input}
              </span>
            );
          }
          return input;
        }
        if (f.kind === 'date') {
          return (
            <label key={f.name} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {f.label}
              <input
                type="date"
                aria-label={f.label}
                value={value}
                onChange={(e) => {
                  set({ [f.name]: e.target.value });
                }}
                className={cn(control, 'text-foreground')}
              />
            </label>
          );
        }
        return (
          <select
            key={f.name}
            aria-label={f.label}
            value={value}
            onChange={(e) => {
              set({ [f.name]: e.target.value });
            }}
            className={cn(control, 'max-w-56 pr-8', value && 'border-foreground font-medium')}
          >
            <option value="">{`${f.label}: ${f.allLabel}`}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      })}
      {more.length > 0 && moreLabel && (
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => {
            setShowMore(!showMore);
          }}
          className={cn(control, 'inline-flex items-center gap-1.5 font-medium')}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          {moreLabel}
          {moreActive > 0 && (
            <span className="rounded-full bg-foreground px-1.5 text-xs text-background">
              {moreActive}
            </span>
          )}
        </button>
      )}
      {active && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            set(Object.fromEntries(all.flatMap(names).map((n) => [n, ''])));
          }}
        >
          <X />
          {clearLabel}
        </Button>
      )}
    </div>
  );
}
