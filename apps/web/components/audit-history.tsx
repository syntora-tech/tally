import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMessages, getTranslations } from 'next-intl/server';
import { getLabels } from '@/server/i18n';
import type { ServiceContext } from '@/server/services/context';
import { rowHistory } from '@/server/services/audit';

type Props = {
  ctx: ServiceContext;
  tableName: string;
  rowId: string;
  /** Overrides of the shared `fields` labels; unknown columns are shown as is. */
  fieldLabels?: Record<string, string>;
};

const dateTime = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
});

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function actorName(
  entry: { actorEmail: string | null; actorLabel: string | null; via: string | null },
  t: Awaited<ReturnType<typeof getTranslations<'audit'>>>,
) {
  if (entry.actorEmail)
    return entry.via === 'mcp' ? t('agent', { email: entry.actorEmail }) : entry.actorEmail;
  if (entry.actorLabel) return entry.actorLabel;
  return entry.via ? t('user') : t('direct');
}

/** Change history from audit_log; hidden entirely when RLS returns nothing (viewer). */
export async function AuditHistory({ ctx, tableName, rowId, fieldLabels = {} }: Props) {
  const result = await rowHistory.run(ctx, { tableName, rowId });
  if (result.isErr() || result.value.length === 0) return null;
  const t = await getTranslations('audit');
  const { AUDIT_ACTION_LABELS } = await getLabels();
  const labels = {
    ...((await getMessages()).fields as Record<string, string>),
    ...fieldLabels,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3 text-sm">
          {result.value.map((entry) => (
            <li key={entry.id} className="border-l-2 pl-3">
              <div className="text-muted-foreground">
                {dateTime.format(new Date(entry.at))} · {AUDIT_ACTION_LABELS[entry.action]} ·{' '}
                {actorName(entry, t)}
              </div>
              {entry.action === 'UPDATE' && entry.changes.length > 0 && (
                <ul className="mt-1">
                  {entry.changes.map((c) => (
                    <li key={c.field}>
                      <span className="font-medium">{labels[c.field] ?? c.field}</span>:{' '}
                      {show(c.from)} → {show(c.to)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
