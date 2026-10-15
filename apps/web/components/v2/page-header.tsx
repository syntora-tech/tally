import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { HelpTip } from './help-tip';

/** v2 page header: the title, its explanation under (?), actions on the right. */
export async function PageHeader({
  title,
  help,
  meta,
  children,
}: {
  title: ReactNode;
  help?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const t = await getTranslations('common');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
          {help && <HelpTip label={t('help')}>{help}</HelpTip>}
        </div>
        {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
