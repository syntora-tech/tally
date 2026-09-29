import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AUDIT_ACTION_LABELS } from '@/lib/labels';
import type { ServiceContext } from '@/server/services/context';
import { rowHistory } from '@/server/services/audit';

type Props = {
  ctx: ServiceContext;
  tableName: string;
  rowId: string;
  /** Ukrainian labels for column names; unknown columns are shown as is. */
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

function actorName(entry: {
  actorEmail: string | null;
  actorLabel: string | null;
  via: string | null;
}) {
  if (entry.actorEmail)
    return entry.via === 'mcp' ? `${entry.actorEmail} (агент)` : entry.actorEmail;
  if (entry.actorLabel) return entry.actorLabel;
  return entry.via ? 'користувач' : 'пряма зміна в БД';
}

/** Change history from audit_log; hidden entirely when RLS returns nothing (viewer). */
export async function AuditHistory({ ctx, tableName, rowId, fieldLabels = {} }: Props) {
  const result = await rowHistory.run(ctx, { tableName, rowId });
  if (result.isErr() || result.value.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Історія змін</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3 text-sm">
          {result.value.map((entry) => (
            <li key={entry.id} className="border-l-2 pl-3">
              <div className="text-muted-foreground">
                {dateTime.format(new Date(entry.at))} · {AUDIT_ACTION_LABELS[entry.action]} ·{' '}
                {actorName(entry)}
              </div>
              {entry.action === 'UPDATE' && entry.changes.length > 0 && (
                <ul className="mt-1">
                  {entry.changes.map((c) => (
                    <li key={c.field}>
                      <span className="font-medium">{fieldLabels[c.field] ?? c.field}</span>:{' '}
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
