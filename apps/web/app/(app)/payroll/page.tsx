import { getTranslations } from 'next-intl/server';
import { sum, toDecimal } from '@tally/domain';
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
import { listPayroll, payoutCandidates, type PayrollGroup } from '@/server/services/payroll';
import { listPeriods } from '@/server/services/periods';
import { MergeActsButton, OverrideForm, PayDialog, RateForm, SplitActForm } from './payroll-forms';
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
  const unpaidMonths = items.filter((i) => i.group !== 'paid').map((i) => i.month);
  const candidates = unpaidMonths.length
    ? (
        await payoutCandidates.run(ctx, { since: unpaidMonths.reduce((a, b) => (a < b ? a : b)) })
      ).unwrapOr([])
    : [];
  const [t, tc, tp, fmt, { ADJUSTMENT_KIND_LABELS, FX_SOURCE_LABELS }] = await Promise.all([
    getTranslations('payroll'),
    getTranslations('common'),
    getTranslations('payDialog'),
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
  const USD_LIKE = ['USD', 'USDT', 'USDC'];
  const candidatesFor = (i: (typeof items)[number]) =>
    candidates
      .filter(
        (c) =>
          c.occurredOn >= i.month &&
          (i.item.payoutMethod === 'fiat' ? c.currency === 'UAH' : USD_LIKE.includes(c.currency)),
      )
      .sort(
        (a, b) => Number(b.personId === i.item.personId) - Number(a.personId === i.item.personId),
      )
      .map((c) => ({
        id: c.id,
        remaining: c.remaining,
        label: [
          fmt.date(c.occurredOn),
          c.counterparty ?? c.description ?? '—',
          c.accountName,
          t('left', { amount: fmt.amount(c.remaining, c.currency) }),
        ].join(' · '),
      }));

  // Lines and adjustments in an act: the act of the rest takes those not given to another (A-085).
  const activitiesIn = (i: (typeof items)[number], a: (typeof items)[number]['acts'][number]) => {
    const inAct = (x: { supplierActId: string | null }) =>
      a.isRest ? x.supplierActId === null : x.supplierActId === a.id;
    return [
      ...i.lines.filter(inAct).map((l) => ({
        id: l.id,
        kind: 'line' as const,
        label: `${l.clientName ?? tc('internal')}${l.roleTitle ? ` · ${l.roleTitle}` : ''} · ${fmt.amount(l.amount, l.currency)}`,
      })),
      ...i.adjustments.filter(inAct).map((x) => ({
        id: x.id,
        kind: 'adjustment' as const,
        label: `${ADJUSTMENT_KIND_LABELS[x.kind]}: ${fmt.amount(x.amount, x.currency)} — ${x.reason}`,
      })),
    ];
  };

  // A USD share can go into a new act from the rest or from an act split off by amount (A-086).
  const splitsByAmount = (i: (typeof items)[number], a: (typeof items)[number]['acts'][number]) =>
    !toDecimal(i.item.totalUsd).isZero() && (a.isRest || activitiesIn(i, a).length === 0);

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
                        {i.item.kind === 'agency'
                          ? t('agencyTitle', { payee: i.payeeName ?? '' })
                          : i.personName}{' '}
                        · {fmt.month(i.month)}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {fiat ? 'fiat' : 'crypto'} · {i.payeeName ?? t('noPayee')}
                        {i.nextDeadline && t('deadline', { date: fmt.date(i.nextDeadline) })}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      {(!fiat || !toDecimal(i.item.totalUsd).isZero()) && (
                        <div className="font-medium">{fmt.amount(i.item.totalUsd, 'USD')}</div>
                      )}
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
                    {fiat && !toDecimal(i.item.totalUsd).isZero() && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {i.actStatus === 'issued' ? (
                          <span className="text-muted-foreground">
                            {tp('actIssuedRate', { number: i.actNumber ?? '' })}
                          </span>
                        ) : (
                          // Paid parts keep their rates; the rate stays open for the rest (A-083).
                          i.group !== 'paid' &&
                          toDecimal(i.item.paidAmount).lte(
                            sum(i.acts.filter((a) => a.amountUsd !== null).map((a) => a.amountUah)),
                          ) && (
                            <RateForm
                              itemId={i.item.id}
                              rate={i.item.payoutFxRate}
                              source={i.item.fxSource}
                            />
                          )
                        )}
                      </div>
                    )}
                    {i.acts.length > 0 && (
                      <ul className="flex flex-col gap-1 text-sm" data-testid="payout-acts">
                        {i.acts.map((a, n) => {
                          const next = i.acts[n + 1];
                          return (
                            <li key={a.id} className="flex flex-wrap items-center gap-2">
                              <Link className="hover:underline" href={`/payroll/acts/${a.id}`}>
                                {a.number ?? tp('draftAct')}
                              </Link>
                              <span className="text-muted-foreground">
                                {a.periodFrom && a.periodTo
                                  ? `${fmt.date(a.periodFrom)}–${fmt.date(a.periodTo)}`
                                  : ''}
                              </span>
                              <span>{fmt.amount(a.amountUah, 'UAH')}</span>
                              {a.amountUsd !== null && (
                                <span className="text-muted-foreground">
                                  {tp('partOf', {
                                    usd: fmt.amount(a.amountUsd, 'USD'),
                                    rate: a.fxRate ?? '—',
                                  })}
                                </span>
                              )}
                              {next && a.status === 'draft' && next.status === 'draft' && (
                                <MergeActsButton firstId={a.id} secondId={next.id} />
                              )}
                              {a.status === 'draft' &&
                                !a.rateLocked &&
                                a.periodFrom &&
                                a.periodTo &&
                                a.periodFrom < a.periodTo &&
                                (activitiesIn(i, a).length > 1 || splitsByAmount(i, a)) && (
                                  <SplitActForm
                                    actId={a.id}
                                    periodFrom={a.periodFrom}
                                    periodTo={a.periodTo}
                                    activities={activitiesIn(i, a)}
                                    byAmount={splitsByAmount(i, a)}
                                  />
                                )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
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
                              {l.agencyFee && `${l.personName} · `}
                              {l.clientName ?? tc('internal')}
                              {l.invoiceNumber && (
                                <span className="text-muted-foreground">
                                  {t('invoice', { number: l.invoiceNumber })}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{fmt.amount(l.amount, l.currency)}</TableCell>
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
                        lines={i.lines.map((l) => ({ amount: l.amount, currency: l.currency }))}
                        adjustments={i.adjustments.map((a) => ({
                          amount: a.amount,
                          currency: a.currency,
                        }))}
                        currentRate={i.item.payoutFxRate}
                        currentSource={i.item.fxSource}
                        suggestion={suggestion.unwrapOr(null)}
                        remaining={i.remaining}
                        isOwner={isOwner}
                        candidates={candidatesFor(i)}
                        fee={i.payeeFee}
                        hasAct={i.acts.length > 0}
                        payableActs={i.acts
                          .filter((a) => !a.isRest && !a.rateLocked)
                          .map((a) => ({
                            id: a.id,
                            amount: a.amountUah,
                            label: `${a.number ?? tp('draftAct')} · ${fmt.amount(a.amountUah, 'UAH')}`,
                          }))}
                        feeAccounts={accountRows}
                        accounts={accountRows
                          .filter((a) =>
                            fiat ? a.currency === 'UAH' : USD_LIKE.includes(a.currency),
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
