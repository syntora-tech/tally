import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Panel } from '@/components/v2/panel';
import { shownAccounts } from '@/lib/accounts';
import { FINANCE_ROLES } from '@/lib/navigation';
import { getFormat, pageTitle } from '@/server/i18n';
import { requireRole } from '@/server/request-context';
import { aiEnabled } from '@/server/services/ai';
import { listAccounts } from '@/server/services/ledger';
import { listImports } from '@/server/services/ledger/import';
import { getUiPrefs } from '@/server/ui-prefs';
import { LedgerHeader } from '../ledger-v2';
import { BankStatementForm, CryptoFetchForm } from './import-forms';

export const generateMetadata = pageTitle('ledgerImport');
// Fetching the chain and asking Claude runs in this page's server action (A-122).
export const maxDuration = 300;

type Source = { file?: string; network?: string; from?: string | null; to?: string | null };
type Summary = { created?: number; linked?: number };

/** Statement import (A-121) and, with a personal AI key, crypto payments (A-122). */
export default async function LedgerImportPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const [accounts, imports, withAi, t, fmt, v2] = await Promise.all([
    listAccounts.run(ctx, {}),
    listImports.run(ctx, {}),
    aiEnabled(ctx),
    getTranslations('ledgerImport'),
    getFormat(),
    getUiPrefs().then((p) => p.version === 'v2'),
  ]);
  const banks = shownAccounts(accounts.unwrapOr([]))
    .filter(({ account: a }) => a.kind === 'bank')
    .map(({ account: a }) => ({ id: a.id, label: `${a.name} (${a.currency})` }));
  const section = (title: string, help: string, body: ReactNode) =>
    v2 ? (
      <Panel title={title} help={help}>
        {body}
      </Panel>
    ) : (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{help}</CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    );
  const recent = imports.unwrapOr([]);

  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <LedgerHeader section="import" title={t('title')} help={t('subtitle')} />
      ) : (
        <div>
          <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
            ← Ledger
          </Link>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
      )}
      {section(t('bankTitle'), t('bankHelp'), <BankStatementForm accounts={banks} />)}
      {withAi && section(t('cryptoTitle'), t('cryptoHelp'), <CryptoFetchForm />)}
      {section(
        t('recent'),
        t('recentHelp'),
        recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noImports')}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {recent.map((i) => {
              const sources = i.sources as Source[];
              const summary = i.summary as Summary;
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <Link href={`/ledger/import/${i.id}`} className="font-medium hover:underline">
                    {i.kind === 'bank'
                      ? sources.map((s) => s.file).join(', ')
                      : t('cryptoSources', {
                          networks: [...new Set(sources.map((s) => s.network))].join(', '),
                        })}
                  </Link>
                  <Badge variant={i.status === 'committed' ? 'default' : 'outline'}>
                    {t(`status.${i.status as 'draft' | 'committed' | 'discarded'}`)}
                  </Badge>
                  <span className="text-muted-foreground">
                    {fmt.date(i.createdAt.toISOString().slice(0, 10))}
                  </span>
                  {i.status === 'committed' && (
                    <span className="text-muted-foreground">
                      {t('bookedSummary', {
                        created: summary.created ?? 0,
                        linked: summary.linked ?? 0,
                      })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ),
      )}
    </div>
  );
}
