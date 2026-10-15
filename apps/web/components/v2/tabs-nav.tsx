import { cn } from 'cn';
import Link from 'next/link';

export type TabLink = { key: string; label: string; href: string; count?: number };

/** Tabs as links: the URL keeps the choice, and switching needs no "Show" button. */
export function TabsNav({
  tabs,
  active,
  label,
}: {
  tabs: TabLink[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              current
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  current ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
