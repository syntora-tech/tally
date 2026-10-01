import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { suggestRate } from '@/server/services/fx';
import { listAccounts } from '@/server/services/ledger';
import { listPayroll, type PayrollGroup } from '@/server/services/payroll';
import { listPeriods } from '@/server/services/periods';
import { OverrideForm, PayDialog } from './payroll-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('payroll');

const GROUPS: PayrollGroup[] = ['ready', 'waiting', 'paid'];
const LINE_STATUSES = ['accrued', 'awaiting_client', 'payable', 'paid'] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PayrollPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const periodId = typeof params.period === 'string' ? params.period : '';
  const [rows, periods, accounts, suggestion] = await Promise.all([
    listPayroll.run(ctx, { periodId }),
    listPeriods.run(ctx, {}),
    listAccounts.run(ctx, {}),
    suggestRate.run(ctx, { onDate: ctx.today }),
  ]);
  const items = rows.unwrapOr([]);
  const [t, tc, fmt, { ADJUSTMENT_KIND_LABELS, FX_SOURCE_LABELS }] = await Promise.all([
    getTranslations('payroll'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);
  const lineStatus = (s: string) =>
    (LINE_STATUSES as readonly string[]).includes(s)
      ? t(`lineStatus.${s as (typeof LINE_STATUSES)[number]}`)
      : s;
  const accountRows = accounts.unwrapOr([]).map(({ account: a, balance }) => ({
    id: a.id,
    currency: a.currency,
    label: `${a.name} · ${fmt.amount(balance, a.currency)}`,
  }));
  const isOwner = ctx.actor.role === 'owner';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={t('period')}>
          <Button size="sm" variant="secondary" render={<Link href="/payroll/acts" />}>
            {t('actsRegistry')}
          </Button>
          <Button
            size="sm"
            variant={periodId ? 'outline' : 'default'}
            render={<Link href="/payroll" />}
          >
            {t('all')}
          </Button>
          {periods
            .unwrapOr([])
            .filter((p) => p.period.status === 'closed')
            .slice(0, 6)
            .map(({ period: p }) => (
              <Button
                key={p.id}
                size="sm"
                variant={p.id === periodId ? 'default' : 'outline'}
                render={<Link href={`/payroll?period=${p.id}`} />}
              >
                {fmt.month(p.month)}
              </Button>
            ))}
        </nav>
      </div>

      {items.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}

      {GROUPS.map((g) => {
        const group = items.filter((i) => i.group === g);
        if (group.length === 0) return null;
        const title = t(`groups.${g}`);
        return (
          <section key={g} className="flex flex-col gap-3" aria-label={title}>
            <h2 className="text-lg font-semibold">
              {title} ({group.length})
            </h2>
            {group.map((i) => {
              const fiat = i.item.payoutMethod === 'fiat';
              return (
                <Card key={i.item.id} data-testid="payroll-item">
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {i.personName} · {fmt.month(i.month)}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {fiat ? 'fiat' : 'crypto'} · {i.payeeName ?? t('noPayee')}
                        {i.nextDeadline && t('deadline', { date: fmt.date(i.nextDeadline) })}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-medium">{fmt.amount(i.item.totalUsd, 'USD')}</div>
                      {fiat && (
                        <div>
                          {i.item.totalUah ? fmt.amount(i.item.totalUah, 'UAH') : t('noRate')}
                          {i.item.fxSource && (
                            <Badge variant="outline" className="ml-2">
                              {i.item.payoutFxRate} · {FX_SOURCE_LABELS[i.item.fxSource]}
                            </Badge>
                          )}
                        </div>
                      )}
                      {i.remaining !== null && i.group !== 'paid' && (
                        <div className="text-muted-foreground">
                          {t('remaining', { amount: fmt.amount(i.remaining, i.currency) })}
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('col.work')}</TableHead>
                          <TableHead>{t('col.usd')}</TableHead>
                          <TableHead>{t('col.status')}</TableHead>
                          <TableHead>{t('col.funding')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {i.lines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>
                              {l.clientName ?? tc('internal')}
                              {l.invoiceNumber && (
                                <span className="text-muted-foreground">
                                  {t('invoice', { number: l.invoiceNumber })}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{fmt.amount(l.amountUsd)}</TableCell>
                            <TableCell>
                              {lineStatus(l.status)}
                              {l.status === 'awaiting_client' && l.deadline && (
                                <span className="text-muted-foreground">
                                  {t('until', { date: fmt.date(l.deadline) })}
                                </span>
                              )}
                              {l.overrideReason && (
                                <div className="text-xs text-muted-foreground">
                                  {t('released', { reason: l.overrideReason })}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {l.fundingSource === 'client'
                                ? t('fundingClient')
                                : l.fundingSource === 'company'
                                  ? t('fundingCompany')
                                  : '—'}
                              {isOwner && l.status === 'awaiting_client' && (
                                <OverrideForm lineId={l.id} />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {i.adjustments.length > 0 && (
                      <ul className="text-sm">
                        {i.adjustments.map((a) => (
                          <li key={a.id}>
                            {ADJUSTMENT_KIND_LABELS[a.kind]}: {fmt.amount(a.amount, a.currency)} —{' '}
                            {a.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    {i.group !== 'paid' && (
                      <PayDialog
                        itemId={i.item.id}
                        fiat={fiat}
                        today={ctx.today}
                        linesUsd={i.lines.map((l) => l.amountUsd)}
                        adjustments={i.adjustments.map((a) => ({
                          amount: a.amount,
                          currency: a.currency,
                        }))}
                        currentRate={i.item.payoutFxRate}
                        currentSource={i.item.fxSource}
                        suggestion={suggestion.unwrapOr(null)}
                        remaining={i.remaining}
                        isOwner={isOwner}
                        accounts={accountRows
                          .filter((a) =>
                            fiat
                              ? a.currency === 'UAH'
                              : ['USD', 'USDT', 'USDC'].includes(a.currency),
                          )
                          .map(({ id, label }) => ({ id, label }))}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
