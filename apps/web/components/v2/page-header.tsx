import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Crumb, type CrumbLink } from './crumb';
import { HelpTip } from './help-tip';

/**
 * v2 page header: the title with its statuses beside it, the explanation under (?), a quiet line
 * under the title, actions on the right. A string title also becomes the last breadcrumb.
 */
export async function PageHeader({
  title,
  help,
  leading,
  badges,
  meta,
  crumb,
  crumbParents,
  children,
}: {
  title: ReactNode;
  help?: ReactNode;
  /** Before the title on its line, e.g. the ‹ of a month switcher. */
  leading?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  crumb?: string;
  crumbParents?: CrumbLink[];
  children?: ReactNode;
}) {
  const t = await getTranslations('common');
  const crumbLabel = crumb ?? (typeof title === 'string' ? title : undefined);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {crumbLabel && <Crumb label={crumbLabel} parents={crumbParents} />}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {leading}
          <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
            {title}
          </h1>
          {help && <HelpTip label={t('help')}>{help}</HelpTip>}
          {badges}
        </div>
        {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
      </div>
      {children && (
        <div data-page-actions className="ml-auto flex flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
