import {
  addMonths,
  endOfMonth,
  isCryptoNetwork,
  shortAddress,
  startOfMonth,
  toDecimal,
  transactionExplorerUrl,
  type LocalDate,
} from '@tally/domain';
import { cn } from 'cn';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ExternalLink, Pencil } from 'lucide-react';
import type { Result } from 'neverthrow';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AutoFilters } from '@/components/v2/auto-filters';
import { HelpTip } from '@/components/v2/help-tip';
import { PageHeader } from '@/components/v2/page-header';
import { EmptyState } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';
import { TabsNav } from '@/components/v2/tabs-nav';
import { getFormat, getLabels } from '@/server/i18n';
import { impliedRate, type listAccounts, type listTransactions } from '@/server/services/ledger';
import { RowMenu } from '@/components/v2/form-dialog';
import { DeleteTransactionForm } from './ledger-forms';

type OkOf<T> = T extends Result<infer V, unknown> ? V : never;
type AccountRow = OkOf<Awaited<ReturnType<typeof listAccounts.run>>>[number];
type TxRow = OkOf<Awaited<ReturnType<typeof listTransactions.run>>>[number];

export const LEDGER_PAGE = 100;

const SECTIONS = [
  { key: 'journal', href: '/ledger' },
  { key: 'accounts', href: '/ledger/accounts' },
  { key: 'categories', href: '/ledger/categories' },
  { key: 'rates', href: '/ledger/rates' },
  { key: 'planned', href: '/ledger/planned' },
  { key: 'reconcile', href: '/ledger/reconcile' },
] as const;

/** v2 header of every Ledger page: one title, the sections as tabs, the main action. */
export async function LedgerHeader({
  section,
  title,
  help,
  children,
}: {
  section: (typeof SECTIONS)[number]['key'];
  title?: string;
  help?: string;
  children?: ReactNode;
}) {
  const t = await getTranslations('ledger');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title ?? (section === 'journal' ? 'Ledger' : t(section))} help={help}>
        {children ?? (
          <Button render={<Link href="/ledger/new" />}>+ {t('v2.newTransaction')}</Button>
        )}
      </PageHeader>
      <TabsNav
        label={t('v2.sections')}
        active={section}
        tabs={SECTIONS.map((s) => ({
          key: s.key,
          href: s.href,
          label: s.key === 'journal' ? t('v2.journal') : t(s.key),
        }))}
      />
    </div>
  );
}

export async function LedgerV2({
  accounts,
  categories,
  journal,
  filters,
  limit,
  moreHref,
  today,
}: {
  accounts: AccountRow[];
  categories: { id: string; name: string; txType: string }[];
  journal: TxRow[];
  filters: { accountId: string; unallocated: string };
  limit: number;
  moreHref: string;
  today: LocalDate;
}) {
  const [t, tc, fmt, { TX_TYPE_LABELS }, locale] = await Promise.all([
    getTranslations('ledger'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
    getLocale(),
  ]);
  // Only the day groups are spelled out; every other date stays DD.MM.YYYY.
  const dayLabel = new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const monthStart = startOfMonth(today);
  const lastMonth = addMonths(monthStart, -1);
  const accountHref = (id: string) => {
    const q = new URLSearchParams();
    if (id) q.set('accountId', id);
    if (filters.unallocated) q.set('unallocated', filters.unallocated);
    const s = q.toString();
    return s ? `/ledger?${s}` : '/ledger';
  };
  const byDate = new Map<string, TxRow[]>();
  for (const tx of journal) {
    const d = tx.transaction.occurredOn;
    byDate.set(d, [...(byDate.get(d) ?? []), tx]);
  }

  const chip = (on: boolean) =>
    cn(
      'flex min-w-40 shrink-0 flex-col gap-1 rounded-lg border px-3.5 py-2.5 text-left transition-colors',
      on ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted/60',
    );

  return (
    <div className="flex flex-col gap-5">
      <LedgerHeader section="journal" help={t('subtitle')} />

      <nav aria-label={t('accounts')} className="flex gap-2 overflow-x-auto pb-1">
        <Link
          href={accountHref('')}
          aria-current={filters.accountId ? undefined : 'page'}
          className={chip(!filters.accountId)}
        >
          <span className="text-sm font-medium">{t('v2.allAccounts')}</span>
          <span className="text-xs opacity-70">
            {t('v2.accountsCount', { count: accounts.length })}
          </span>
        </Link>
        {accounts.map(({ account: a, balance }) => (
          <Link
            key={a.id}
            href={accountHref(a.id)}
            aria-current={filters.accountId === a.id ? 'page' : undefined}
            className={chip(filters.accountId === a.id)}
            title={a.address ?? undefined}
          >
            <span className="truncate text-sm">
              {a.name}
              {a.network ? ` · ${a.network}` : ''}
            </span>
            <span className="font-semibold tabular-nums">{fmt.amount(balance, a.currency)}</span>
          </Link>
        ))}
        {accounts.length === 0 && (
          <Link href="/ledger/accounts" className="text-sm text-link hover:underline">
            {t('noAccounts')} {t('addThem')}
          </Link>
        )}
      </nav>

      <AutoFilters
        label={t('filters')}
        clearLabel={t('v2.clear')}
        resets={['limit']}
        fields={[
          {
            kind: 'text',
            name: 'q',
            label: t('v2.search'),
            placeholder: t('v2.searchPlaceholder'),
            search: true,
          },
          {
            kind: 'range',
            from: 'from',
            to: 'to',
            label: t('v2.period'),
            fromLabel: t('from'),
            toLabel: t('to'),
            presets: [
              { label: t('v2.thisMonth'), from: monthStart, to: endOfMonth(monthStart) },
              { label: t('v2.lastMonth'), from: lastMonth, to: endOfMonth(lastMonth) },
              {
                label: t('v2.thisYear'),
                from: `${today.slice(0, 4)}-01-01`,
                to: `${today.slice(0, 4)}-12-31`,
              },
            ],
          },
          {
            kind: 'select',
            name: 'type',
            label: t('type'),
            allLabel: t('all'),
            options: Object.entries(TX_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          },
          {
            kind: 'select',
            name: 'categoryId',
            label: t('category'),
            allLabel: t('all'),
            options: categories.map((c) => ({
              value: c.id,
              label: `${c.name} (${TX_TYPE_LABELS[c.txType] ?? c.txType})`,
            })),
          },
          { kind: 'toggle', name: 'unallocated', label: t('unallocated') },
        ]}
      />

      {journal.length === 0 ? (
        <EmptyState title={t('noTransactions')} />
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="hidden grid-cols-[2rem_minmax(0,1fr)_11rem_9rem_9rem_4.5rem] gap-3 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span />
            <span>{t('col.description')}</span>
            <span>{t('account')}</span>
            <span className="flex items-center gap-1.5">
              {t('col.allocated')}
              <HelpTip label={tc('help')}>{t('v2.allocationHelp')}</HelpTip>
            </span>
            <span className="text-right">{t('v2.amount')}</span>
            <span />
          </div>
          {[...byDate.entries()].map(([date, rows]) => (
            <section key={date} aria-label={fmt.date(date)}>
              <h3 className="border-b bg-muted/50 px-4 py-1.5 text-xs font-semibold text-muted-foreground">
                {dayLabel
                  .formatToParts(new Date(`${date}T00:00:00Z`))
                  .filter((part) => part.type !== 'literal')
                  .map((part) => part.value)
                  .join(' ')}
              </h3>
              <ul className="divide-y">
                {rows.map((tx) => {
                  const type = tx.transaction.type;
                  const main = tx.postings.filter((p) => !p.isFee);
                  const fees = tx.postings.filter((p) => p.isFee);
                  const rate = impliedRate(tx.postings);
                  const network = tx.postings.map((p) => p.network).find((n) => n !== null) ?? null;
                  const explorer = transactionExplorerUrl(
                    network && isCryptoNetwork(network) ? network : null,
                    tx.transaction.externalRef,
                    tx.transaction.description,
                  );
                  const party = tx.transaction.personId
                    ? { href: `/people/${tx.transaction.personId}`, name: tx.personName }
                    : tx.transaction.clientId
                      ? { href: `/clients/${tx.transaction.clientId}`, name: tx.clientName }
                      : null;
                  const title =
                    party?.name ??
                    tx.transaction.counterparty ??
                    tx.transaction.description ??
                    tx.categoryName;
                  const settles = type === 'revenue' || type === 'expense';
                  const allocated = toDecimal(tx.allocated);
                  const open =
                    settles && tx.mainAmount !== null && allocated.lt(toDecimal(tx.mainAmount));
                  const Icon =
                    type === 'revenue'
                      ? ArrowDownLeft
                      : type === 'expense'
                        ? ArrowUpRight
                        : ArrowLeftRight;
                  return (
                    <li
                      key={tx.transaction.id}
                      data-testid="ledger-row"
                      className="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/40 md:grid-cols-[2rem_minmax(0,1fr)_11rem_9rem_9rem_4.5rem]"
                    >
                      <span
                        aria-label={TX_TYPE_LABELS[type]}
                        title={TX_TYPE_LABELS[type]}
                        className={cn(
                          'flex size-8 items-center justify-center rounded-full',
                          type === 'revenue'
                            ? 'bg-success text-success-foreground'
                            : type === 'expense'
                              ? 'bg-muted text-foreground'
                              : 'bg-info text-info-foreground',
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {party ? (
                            <Link href={party.href} className="hover:underline">
                              {title}
                            </Link>
                          ) : (
                            title
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[
                            tx.categoryName,
                            party && tx.transaction.counterparty,
                            tx.transaction.description !== title && tx.transaction.description,
                            tx.transaction.counterpartyAddress &&
                              shortAddress(tx.transaction.counterpartyAddress),
                            rate && type !== 'transfer' && t('rate', { rate: rate.toFixed(6) }),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {explorer && (
                            <a
                              href={explorer}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1.5 inline-flex items-center gap-0.5 text-link hover:underline"
                            >
                              <ExternalLink className="size-3" />
                              {t('explorer')}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="col-start-2 truncate text-xs text-muted-foreground md:col-start-auto md:text-sm md:text-foreground">
                        {[...new Set(main.map((p) => p.accountName))].join(' → ')}
                      </div>
                      <div className="col-start-2 md:col-start-auto">
                        {settles ? (
                          open ? (
                            <Status tone="warning" testId="allocation">
                              {allocated.isZero()
                                ? t('v2.notAllocated')
                                : t('allocatedOf', {
                                    allocated: fmt.amount(tx.allocated),
                                    total: fmt.amount(tx.mainAmount ?? '0'),
                                  })}
                            </Status>
                          ) : (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid="allocation"
                            >
                              ✓ {t('v2.allocated')}
                            </span>
                          )
                        ) : null}
                      </div>
                      <div className="col-start-3 row-start-1 text-right tabular-nums md:col-start-auto md:row-start-auto">
                        {main.map((p) => (
                          <div
                            key={p.id}
                            className={cn(
                              'font-semibold',
                              toDecimal(p.amount).gt(0) && 'text-success-foreground',
                            )}
                          >
                            {toDecimal(p.amount).gt(0) ? '+' : ''}
                            {fmt.amount(p.amount, p.currency)}
                          </div>
                        ))}
                        {fees.map((p) => (
                          <div key={p.id} className="text-xs text-muted-foreground">
                            {t('v2.fee', { amount: fmt.amount(p.amount, p.currency) })}
                          </div>
                        ))}
                      </div>
                      <div className="col-start-3 flex justify-end gap-1 md:col-start-auto md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={t('edit')}
                          title={t('edit')}
                          render={<Link href={`/ledger/${tx.transaction.id}/edit`} />}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {allocated.isZero() && (
                          <RowMenu
                            label={tc('actions')}
                            entries={[
                              {
                                label: t('v2.deleteAction'),
                                destructive: true,
                                dialog: {
                                  title: t('v2.deleteTitle'),
                                  content: <DeleteTransactionForm id={tx.transaction.id} />,
                                },
                              },
                            ]}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {journal.length >= limit && (
        <div className="flex justify-center">
          {limit < 1000 ? (
            <Button variant="outline" render={<Link href={moreHref} scroll={false} />}>
              {t('v2.showMore')}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t('limitReached', { limit })}</p>
          )}
        </div>
      )}
    </div>
  );
}
