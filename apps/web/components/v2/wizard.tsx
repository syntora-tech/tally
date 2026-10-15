import { cn } from 'cn';
import { Check } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { HelpTip } from './help-tip';

export type WizardStep = { title: string; help?: string; content: ReactNode };

/**
 * One step on screen at a time, the list of steps above it; steps are links (`?step=n`), so a
 * reload or a shared link opens the same step.
 */
export function Wizard({
  steps,
  current,
  hrefOf,
  allDone = false,
  labels,
}: {
  steps: WizardStep[];
  /** 1-based. */
  current: number;
  hrefOf: (step: number) => string;
  allDone?: boolean;
  labels: { steps: string; back: string; next: (title: string) => string; help: string };
}) {
  const step = steps[current - 1] ?? steps[0];
  if (!step) return null;
  const next = steps[current];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <nav aria-label={labels.steps} className="min-w-0">
        <ol className="flex gap-2 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const n = i + 1;
            const now = n === current;
            const done = allDone || n < current;
            return (
              <li key={s.title} className="shrink-0">
                <Link
                  href={hrefOf(n)}
                  aria-current={now ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm whitespace-nowrap transition-colors',
                    now
                      ? 'border-2 border-foreground bg-card font-semibold'
                      : 'bg-card hover:bg-muted/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      now
                        ? 'bg-neon text-black'
                        : done
                          ? 'bg-foreground text-background dark:bg-neon dark:text-black'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {done && !now ? <Check className="size-3.5" strokeWidth={3} /> : n}
                  </span>
                  {s.title}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      <section className="flex min-w-0 flex-col rounded-lg border bg-card" aria-label={step.title}>
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <h2 className="font-heading text-lg font-semibold">{step.title}</h2>
          {step.help && <HelpTip label={labels.help}>{step.help}</HelpTip>}
        </div>
        <div className="min-w-0 overflow-x-auto px-5 py-4">{step.content}</div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t px-5 py-3">
          {current > 1 ? (
            <Button variant="ghost" render={<Link href={hrefOf(current - 1)} />}>
              {labels.back}
            </Button>
          ) : (
            <span />
          )}
          {next && (
            <Button render={<Link href={hrefOf(current + 1)} />}>{labels.next(next.title)}</Button>
          )}
        </div>
      </section>
    </div>
  );
}
