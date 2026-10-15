import { cn } from 'cn';
import { Check } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { HelpTip } from './help-tip';

export type WizardStep = {
  title: string;
  /** One line under the step's title: where that step stands. */
  summary?: string;
  help?: string;
  /** Buttons on the right of the step's title, e.g. an import. */
  actions?: ReactNode;
  /** The content is a table that runs edge to edge. */
  flush?: boolean;
  content: ReactNode;
};

/**
 * One step on screen at a time, the list of steps above it; steps are links (`?step=n`), so a
 * reload or a shared link opens the same step.
 */
export function Wizard({
  steps,
  current,
  hrefOf,
  allDone = false,
  footer,
  labels,
}: {
  steps: WizardStep[];
  /** 1-based. */
  current: number;
  hrefOf: (step: number) => string;
  allDone?: boolean;
  /** Left side of the bottom bar, e.g. a total. */
  footer?: ReactNode;
  labels: { steps: string; back: string; next: (title: string) => string; help: string };
}) {
  const step = steps[current - 1] ?? steps[0];
  if (!step) return null;
  const next = steps[current];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <nav aria-label={labels.steps} className="min-w-0">
        <ol className="grid grid-flow-col auto-cols-[minmax(10.5rem,1fr)] gap-2 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const n = i + 1;
            const now = n === current;
            const done = allDone || n < current;
            return (
              <li key={s.title} className="min-w-0">
                <Link
                  href={hrefOf(n)}
                  aria-current={now ? 'step' : undefined}
                  className={cn(
                    'flex h-full items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors',
                    now ? 'border-2 border-foreground' : 'hover:bg-muted/60',
                  )}
                >
                  <span
                    className={cn(
                      'mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      now
                        ? 'bg-neon text-black'
                        : done
                          ? 'bg-foreground text-background dark:bg-neon dark:text-black'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {done && !now ? <Check className="size-3.5" strokeWidth={3} /> : n}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('truncate', now ? 'font-semibold' : 'font-medium')}>
                      {s.title}
                    </span>
                    {s.summary && (
                      <span className="truncate text-xs text-muted-foreground">{s.summary}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      <section className="flex min-w-0 flex-col rounded-lg border bg-card" aria-label={step.title}>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-4">
          <h2 className="font-heading text-[17px] font-bold">{step.title}</h2>
          {step.help && <HelpTip label={labels.help}>{step.help}</HelpTip>}
          {step.actions && (
            <div className="ml-auto flex flex-wrap items-center gap-2">{step.actions}</div>
          )}
        </div>
        <div className={cn('min-w-0 overflow-x-auto', !step.flush && 'px-5 py-4')}>
          {step.content}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">{footer}</div>
        {current > 1 && (
          <Button variant="outline" render={<Link href={hrefOf(current - 1)} />}>
            {labels.back}
          </Button>
        )}
        {next && (
          <Button
            variant="outline"
            className="border-foreground"
            render={<Link href={hrefOf(current + 1)} />}
          >
            {labels.next(next.title)}
          </Button>
        )}
      </div>
    </div>
  );
}
