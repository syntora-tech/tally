import { cn } from 'cn';
import type { ReactNode } from 'react';
import { HelpTip } from './help-tip';

/**
 * A v2 section card: Manrope title, optional (?) and actions on the right. `flush` drops the body
 * padding for a table that runs edge to edge under a ruled title.
 */
export function Panel({
  title,
  help,
  helpLabel = '?',
  action,
  children,
  flush = false,
  emphasis = false,
  className,
  testId,
}: {
  title?: ReactNode;
  help?: ReactNode;
  helpLabel?: string;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  emphasis?: boolean;
  className?: string;
  testId?: string;
}) {
  const label = typeof title === 'string' ? title : undefined;
  const head = title ? (
    <div className={cn('flex flex-wrap items-center gap-2', flush && 'border-b px-5 py-4')}>
      <h2 className="font-heading text-[17px] font-bold tracking-tight">{title}</h2>
      {help && <HelpTip label={helpLabel}>{help}</HelpTip>}
      {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  ) : null;
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className={cn(
        'flex min-w-0 flex-col rounded-lg bg-card text-sm',
        emphasis ? 'border-2 border-foreground' : 'border',
        flush ? 'overflow-x-auto' : 'gap-3 px-5 py-4',
        className,
      )}
    >
      {head}
      {children}
    </section>
  );
}

/** Label on the left, value on the right: the facts column of a card page. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('flex flex-col gap-2.5 text-sm', className)}>{children}</dl>;
}

export function Fact({
  label,
  children,
  strong = false,
  tone,
}: {
  label: ReactNode;
  children: ReactNode;
  strong?: boolean;
  tone?: 'danger';
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', strong && 'font-bold')}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-right tabular-nums [overflow-wrap:anywhere]',
          strong && 'font-heading text-lg',
          tone === 'danger' && 'font-medium text-danger-foreground',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function FactsRule() {
  return <div role="separator" className="h-px bg-border" />;
}

/** Dashed box for "nothing here yet", with the action that fills it. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-input px-6 py-8 text-center',
        className,
      )}
    >
      <p className="font-heading text-base font-bold">{title}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

/** Two columns of a card page: the work on the left, facts on the right. */
export function CardLayout({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">{main}</div>
      <aside className="flex min-w-0 flex-col gap-4">{aside}</aside>
    </div>
  );
}

/** Ruled label/value rows of a profile or terms card (label column on the left). */
export function KeyValues({ children }: { children: ReactNode }) {
  return <dl className="-mb-1 flex flex-col text-sm">{children}</dl>;
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 border-t py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children ?? '—'}</dd>
    </div>
  );
}
