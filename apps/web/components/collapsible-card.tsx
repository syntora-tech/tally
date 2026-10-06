import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * A card whose body folds away: open when it already has content, so empty sections (no wallets,
 * no payout taxes) do not crowd a person's page.
 */
export function CollapsibleCard({
  title,
  description,
  count,
  open,
  children,
}: {
  title: string;
  description?: string;
  count?: number;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="py-0">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
          <span className="font-heading text-base font-medium">
            {title}
            {count ? <span className="ml-2 text-muted-foreground">{count}</span> : null}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {children}
        </div>
      </details>
    </Card>
  );
}

/** The form for a new entry, folded under "+ Add" once the section has entries. */
export function AddDetails({
  label,
  open,
  children,
}: {
  label: string;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group/add">
      <summary className="w-fit cursor-pointer list-none text-sm font-medium text-primary hover:underline group-open/add:mb-3 [&::-webkit-details-marker]:hidden">
        + {label}
      </summary>
      {children}
    </details>
  );
}
