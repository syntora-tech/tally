import { cn } from 'cn';
import { Check } from 'lucide-react';

/**
 * Progress through fixed steps, e.g. document → signature → payment (A-096). `current` is the
 * index of the step to do next; `steps.length` means all done.
 */
export function Steps({
  steps,
  current,
  label,
  compact = false,
}: {
  steps: string[];
  current: number;
  label: string;
  /** In a table row: only the current step is named on narrow screens. */
  compact?: boolean;
}) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      {steps.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={step}
            className="flex items-center gap-2"
            aria-current={now ? 'step' : undefined}
          >
            <span
              className={cn(
                'inline-flex size-[22px] items-center justify-center rounded-full text-[11px] font-bold',
                done && 'bg-foreground text-background dark:bg-neon dark:text-black',
                now && 'border-2 border-foreground bg-background text-foreground',
                !done && !now && 'bg-muted text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                'text-[13px]',
                now ? 'font-semibold text-foreground' : 'text-muted-foreground',
                compact && !now && 'hidden sm:inline',
              )}
            >
              {step}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-0.5',
                  compact ? 'w-4' : 'w-7',
                  done ? 'bg-foreground dark:bg-neon' : 'bg-input',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
