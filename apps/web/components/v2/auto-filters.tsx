'use client';

import { cn } from 'cn';
import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';

export type FilterField =
  | {
      kind: 'select';
      name: string;
      label: string;
      allLabel: string;
      options: { value: string; label: string }[];
    }
  | { kind: 'date'; name: string; label: string }
  | { kind: 'text'; name: string; label: string; placeholder?: string; inputMode?: 'decimal' }
  | { kind: 'toggle'; name: string; label: string };

/**
 * Filters that apply as soon as they change (text ones on Enter or leaving the field): each one
 * rewrites its query parameter. Parameters named in `resets` (e.g. a page size) go back to default.
 */
export function AutoFilters({
  fields,
  label,
  clearLabel,
  resets = [],
}: {
  fields: FilterField[];
  label: string;
  clearLabel: string;
  resets?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
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
  const active = fields.some((f) => params.get(f.name));
  const control =
    'h-9 rounded-full border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending}
      className={cn('flex flex-wrap items-center gap-2', pending && 'opacity-70')}
    >
      {fields.map((f) => {
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
          return (
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
              className={cn(control, 'w-40', value && 'border-foreground')}
            />
          );
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
      {active && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            set(Object.fromEntries(fields.map((f) => [f.name, ''])));
          }}
        >
          <X />
          {clearLabel}
        </Button>
      )}
    </div>
  );
}
