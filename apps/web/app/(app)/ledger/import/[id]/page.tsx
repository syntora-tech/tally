import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { FINANCE_ROLES } from '@/lib/navigation';
import { getFormat, pageTitle } from '@/server/i18n';
import { requireRole } from '@/server/request-context';
import { aiEnabled } from '@/server/services/ai';
import { getImport } from '@/server/services/ledger/import';
import { getUiPrefs } from '@/server/ui-prefs';
import { LedgerHeader } from '../../ledger-v2';
import { transactionFormData } from '../../transaction-form-data';
import { ImportReview } from './import-review';

export const generateMetadata = pageTitle('ledgerImport');
// Claude answers for a long statement can take a while (A-122).
export const maxDuration = 300;

type Source = {
  file?: string;
  accountId?: string;
  from?: string | null;
  to?: string | null;
  rows?: number;
  skipped?: number;
  overlapping?: number;
  problems?: { line: number; field: string; value: string }[];
  network?: string;
  address?: string;
};

export default async function LedgerImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const found = await getImport.run(ctx, { id });
  if (found.isErr()) notFound();
  const draft = found.value;
  const [form, withAi, t, te, fmt, v2] = await Promise.all([
    transactionFormData(ctx, true),
    aiEnabled(ctx),
    getTranslations('ledgerImport'),
    getTranslations('errors'),
    getFormat(),
    getUiPrefs().then((p) => p.version === 'v2'),
  ]);
  const aiErrorKey = (await searchParams).aiError;
  // Only known message keys are shown, so the URL cannot inject text into the page.
  const aiError =
    typeof aiErrorKey === 'string' && te.has(aiErrorKey as never) ? te(aiErrorKey as never) : null;
  const sources = draft.sources as Source[];
  const accountName = new Map(form.accounts.map((a) => [a.id, a.name]));
  const warnings = ((draft.summary as { warnings?: string[] }).warnings ?? []).map((w) => {
    const [key, values] = w.split('|');
    return key && te.has(key as never)
      ? te(key as never, values ? (JSON.parse(values) as never) : undefined)
      : w;
  });
  const title = draft.kind === 'bank' ? t('reviewBank') : t('reviewCrypto');

  return (
    <div className="flex flex-col gap-5">
      {v2 ? (
        <LedgerHeader section="import" title={title} help={t('reviewHelp')} />
      ) : (
        <div>
          <Link href="/ledger/import" className="text-sm text-muted-foreground hover:underline">
            ← {t('title')}
          </Link>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">{t('reviewHelp')}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={draft.status === 'committed' ? 'default' : 'outline'}>
          {t(`status.${draft.status as 'draft' | 'committed' | 'discarded'}`)}
        </Badge>
        {sources.map((s, i) => (
          <span key={i} className="rounded-md border px-2 py-1 text-muted-foreground">
            {s.file ?? s.network} → {accountName.get(s.accountId ?? '') ?? '?'}
            {s.from && s.to
              ? ` · ${fmt.date(s.from)}–${fmt.date(s.to)}`
              : s.from
                ? ` · ${t('fromDate', { date: fmt.date(s.from) })}`
                : ''}
            {` · ${t('rowsRead', { count: s.rows ?? 0 })}`}
            {s.skipped ? ` · ${t('rowsSkipped', { count: s.skipped })}` : ''}
            {s.overlapping ? ` · ${t('rowsOverlapping', { count: s.overlapping })}` : ''}
          </span>
        ))}
      </div>
      {sources
        .flatMap((s) => (s.problems ?? []).map((p) => ({ ...p, file: s.file })))
        .map((p) => (
          <p key={`${p.file ?? ''}:${String(p.line)}`} className="text-sm text-amber-600">
            {t('unreadRow', { file: p.file ?? '', line: p.line, value: p.value })}
          </p>
        ))}
      {warnings.map((w) => (
        <p key={w} className="text-sm text-amber-600">
          {w}
        </p>
      ))}
      {aiError && (
        <p className="text-sm text-destructive" role="alert">
          {t('aiFailed', { reason: aiError })}
        </p>
      )}
      <ImportReview
        importId={draft.id}
        editable={draft.status === 'draft'}
        rows={draft.rows}
        accounts={form.accounts}
        categories={form.categories}
        people={form.people}
        clients={form.clients}
        aiEnabled={withAi}
      />
    </div>
  );
}
