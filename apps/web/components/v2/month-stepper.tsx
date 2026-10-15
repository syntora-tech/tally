'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type MonthOption = { key: string; label: string; href: string };

/**
 * ‹ Month › with a list of every option; `options` go newest first, so "previous" is the next
 * entry. Extra options (e.g. "All months") come after the months in `extra`.
 */
export function MonthStepper({
  options,
  extra = [],
  current,
  labels,
}: {
  options: MonthOption[];
  extra?: MonthOption[];
  current: string;
  labels: { previous: string; next: string; choose: string };
}) {
  const index = options.findIndex((o) => o.key === current);
  const older = index >= 0 ? options[index + 1] : undefined;
  const newer = index > 0 ? options[index - 1] : undefined;
  const selected = [...options, ...extra].find((o) => o.key === current);
  return (
    <div className="flex items-center rounded-md border bg-background">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={labels.previous}
        disabled={!older}
        render={older ? <Link href={older.href} /> : undefined}
      >
        <ChevronLeft />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              aria-label={labels.choose}
              className="min-w-36 justify-between font-semibold"
            />
          }
        >
          {selected?.label ?? labels.choose}
          <ChevronDown className="size-4 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-80 w-48">
          {[...options, ...extra].map((o) => (
            <DropdownMenuItem
              key={o.key}
              render={<Link href={o.href} />}
              className={o.key === current ? 'font-semibold' : undefined}
            >
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={labels.next}
        disabled={!newer}
        render={newer ? <Link href={newer.href} /> : undefined}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
