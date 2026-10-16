import { redirect } from 'next/navigation';
import { shownAccounts } from '@/lib/accounts';
import { getTranslations } from 'next-intl/server';
import { addMonths, endOfMonth, startOfMonth, sum, toDecimal, type LocalDate } from '@tally/domain';
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
import { listContractorInvoices } from '@/server/services/contractor-invoices';
import { listAccounts } from '@/server/services/ledger';
import { listPayroll, payoutCandidates, type PayrollGroup } from '@/server/services/payroll';
import { listPeriods } from '@/server/services/periods';
import { listPlannedPayments, plannedPaymentCandidates } from '@/server/services/planned/payments';
import { PaymentActions } from '../ledger/planned/planned-forms';
import { DraftContractorInvoiceButton } from './contractor-invoices/contractor-invoice-forms';
import {
  AdjustClosedForm,
  ChangeMethodForm,
  MergeActsButton,
  OverrideForm,
  RemoveLineForm,
  PayDialog,
  RateForm,
  SplitActForm,
} from './payroll-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PayrollV2 } from './payroll-v2';

export const generateMetadata = pageTitle('payroll');

const GROUPS: PayrollGroup[] = ['ready', 'waiting', 'paid'];
const LINE_STATUSES = ['accrued', 'awaiting_client', 'payable', 'paid'] as const;
const ALL = 'all';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PayrollPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const requested = typeof params.period === 'string' ? params.period : undefined;
  const periodId = requested && requested !== ALL ? requested : '';
  const [rows, periods, accounts, suggestion] = await Promise.all([
    listPayroll.run(ctx, { periodId }),
    listPeriods.run(ctx, {}),
    listAccounts.run(ctx, {}),
    suggestRate.run(ctx, { onDate: ctx.today }),
  ]);
  const items = rows.unwrapOr([]);
  if (requested === undefined) {
    // Opens on the latest month that still has something unpaid; "All" is ?period=all.
    const latest = items
      .filter((i) => i.item.status !== 'paid')
      .reduce<(typeof items)[number] | undefined>(
        (a, b) => (a && a.month >= b.month ? a : b),
        undefined,
      );
    if (latest) redirect(`/payroll?period=${latest.item.periodId}`);
  }
  const unpaidMonths = items.filter((i) => i.group !== 'paid').map((i) => i.month);
  const candidates = unpaidMonths.length
    ? (
        await payoutCandidates.run(ctx, { since: unpaidMonths.reduce((a, b) => (a < b ? a : b)) })
      ).unwrapOr([])
    : [];
  // A contractor abroad bills us for their payout (A-090): a person's USD payout to a non-FOP payee.
  const billable = (i: (typeof items)[number]) =>
    i.item.kind === 'person' &&
    i.payeeKind !== null &&
    i.payeeKind !== 'fop' &&
    i.item.payoutMethod !== 'fiat';
  const billedIds = items.filter(billable).map((i) => i.item.id);
  const contractorInvoices = billedIds.length
    ? (await listContractorInvoices.run(ctx, { payrollItemIds: billedIds })).match(
        (r) => r.items.filter((x) => x.status !== 'void'),
        () => [],
      )
    : [];
  const [t, tc, tp, tci, fmt, labels] = await Promise.all([
    getTranslations('payroll'),
    getTranslations('common'),
    getTranslations('payDialog'),
    getTranslations('contractorInvoice'),
    getFormat(),
    getLabels(),
  ]);
  const { ADJUSTMENT_KIND_LABELS, FX_SOURCE_LABELS, DOC_STATUS_LABELS, PAYOUT_METHOD_LABELS } =
    labels;
  const lineStatus = (s: string) =>
    (LINE_STATUSES as readonly string[]).includes(s)
      ? t(`lineStatus.${s as (typeof LINE_STATUSES)[number]}`)
      : s;
  const accountRows = shownAccounts(accounts.unwrapOr([])).map(({ account: a, balance }) => ({
    id: a.id,
    currency: a.currency,
    label: `${a.name} · ${fmt.amount(balance, a.currency)}`,
  }));
  const isOwner = ctx.actor.role === 'owner';
  const USD_LIKE = ['USD', 'USDT', 'USDC'];
  // Document → signature → payment (A-096): what the payout needs signed before it is paid.
  const documentOf = (i: (typeof items)[number]) => {
    if (i.payeeKind === 'fop' && i.item.payoutMethod === 'fiat') {
      return {
        kind: 'act' as const,
        signedActIds: i.acts.filter((a) => a.signed).map((a) => a.id),
        restSigned: !!i.acts.find((a) => a.isRest)?.signed,
      };
    }
    if (billable(i)) {
      const ci = contractorInvoices.find((x) => x.payrollItemId === i.item.id);
      return { kind: 'invoice' as const, signed: ci?.status === 'issued' && !!ci.signedAt };
    }
    return null;
  };
  const nextStep = (i: (typeof items)[number]) => {
    const doc = documentOf(i);
    if (doc?.kind === 'act') {
      const open = i.acts.filter((a) => !a.rateLocked);
      if (open.length === 0 || open.some((a) => a.status === 'draft')) return 'issue';
      return open.every((a) => a.signed) ? 'pay' : 'sign';
    }
    if (doc?.kind === 'invoice') {
      const ci = contractorInvoices.find((x) => x.payrollItemId === i.item.id);
      if (!ci || ci.status === 'draft') return 'issue';
      return doc.signed ? 'pay' : 'sign';
    }
    return 'pay';
  };
  // A salary paid without an act (A-097): instalments of a planned expense for a person (a director
  // of the LLC), paid in parts within the month by linking Ledger expenses — no period close needed.
  const month = periods.unwrapOr([]).find((p) => p.period.id === periodId)?.period.month as
    LocalDate | undefined;
  const planned = (
    await listPlannedPayments.run(
      ctx,
      month ? { from: month, to: endOfMonth(addMonths(month, 1)) } : {},
    )
  ).unwrapOr([]);
  const salary = planned.filter(
    (r) =>
      r.payment.personId !== null &&
      r.payment.partId !== null &&
      r.payment.parentId === null &&
      (!month || r.payment.month === month),
  );
  const chargesOf = (id: string) => planned.filter((r) => r.payment.parentId === id);
  const salaryCurrencies = [
    ...new Set(salary.filter((r) => r.payment.status === 'due').map((r) => r.payment.currency)),
  ];
  const salaryCandidates = new Map(
    await Promise.all(
      salaryCurrencies.map(
        async (currency) =>
          [
            currency,
            (
              await plannedPaymentCandidates.run(ctx, {
                currency,
                since: addMonths(month ?? startOfMonth(ctx.today), -1),
                until: addMonths(month ?? startOfMonth(ctx.today), 2),
              })
            ).unwrapOr([]),
          ] as const,
      ),
    ),
  );
  const salaryGroups = [
    ...new Map(
      salary.map((r) => [`${r.payment.personId ?? ''}:${r.payment.month}`, r] as const),
    ).values(),
  ].map((first) => ({
    key: `${first.payment.personId ?? ''}:${first.payment.month}`,
    personName: first.personName,
    month: first.payment.month,
    rows: salary.filter(
      (r) =>
        r.payment.personId === first.payment.personId && r.payment.month === first.payment.month,
    ),
  }));

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

  if ((await getUiPrefs()).version === 'v2') {
    return (
      <PayrollV2
        items={items}
        months={periods
          .unwrapOr([])
          .filter((p) => p.period.status === 'closed')
          .map(({ period: p }) => ({ id: p.id, month: p.month }))}
        periodId={periodId}
        tab={typeof params.tab === 'string' ? params.tab : undefined}
        linkPay={
          typeof params.pay === 'string' && typeof params.tx === 'string'
            ? { itemId: params.pay, transactionId: params.tx }
            : null
        }
        isOwner={isOwner}
        today={ctx.today}
        contractorInvoices={contractorInvoices}
        accountRows={accountRows}
        suggestion={suggestion.unwrapOr(null)}
        billable={billable}
        documentOf={documentOf}
        nextStep={nextStep}
        candidatesFor={candidatesFor}
        activitiesIn={activitiesIn}
        splitsByAmount={splitsByAmount}
        payAccounts={(fiat) =>
          accountRows
            .filter((a) => (fiat ? a.currency === 'UAH' : USD_LIKE.includes(a.currency)))
            .map(({ id, label }) => ({ id, label }))
        }
        salaryGroups={salaryGroups}
        chargesOf={chargesOf}
        salaryCandidates={(currency) =>
          (salaryCandidates.get(currency) ?? []).map((c) => ({
            id: c.id,
            label: [
              fmt.date(c.occurredOn),
              c.counterparty ?? c.description ?? '—',
              fmt.amount(c.amount, currency),
            ].join(' · '),
          }))
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={t('period')}>
          <Button size="sm" variant="secondary" render={<Link href="/acts" />}>
            {t('actsRegistry')}
          </Button>
          <Button
            size="sm"
            variant={periodId ? 'outline' : 'default'}
            render={<Link href={`/payroll?period=${ALL}`} />}
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

      {salaryGroups.length > 0 && (
        <section className="flex flex-col gap-3" aria-label={t('salaryTitle')}>
          <h2 className="text-lg font-semibold">{t('salaryTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('salaryHint')}</p>
          {salaryGroups.map((g) => (
            <Card key={g.key} data-testid="salary-payout">
              <CardHeader>
                <CardTitle className="text-base">
                  {g.personName} · {fmt.month(g.month)}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t('salaryNoAct')}</p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('salaryPart')}</TableHead>
                      <TableHead>{t('salaryDue')}</TableHead>
                      <TableHead>{t('salaryAmount')}</TableHead>
                      <TableHead>{t('salaryTaxes')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map(({ payment: p, transactions, overdue }) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className={overdue ? 'text-destructive' : undefined}>
                          {fmt.date(p.dueOn)}
                        </TableCell>
                        <TableCell>
                          {fmt.amount(p.amount, p.currency)}
                          {p.gross && (
                            <div className="text-xs text-muted-foreground">
                              {t('salaryGross', { amount: fmt.amount(p.gross, p.currency) })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {chargesOf(p.id).map((c) => (
                            <div key={c.payment.id}>
                              {c.payment.name}: {fmt.amount(c.payment.amount, c.payment.currency)}
                              {c.payment.status === 'paid' && ` · ${t('salaryPaid')}`}
                            </div>
                          ))}
                        </TableCell>
                        <TableCell>
                          {p.status === 'due' ? (
                            <PaymentActions
                              id={p.id}
                              isInstalment
                              amount={p.amount}
                              gross={p.gross}
                              currency={p.currency}
                              fee={
                                p.feeAmount
                                  ? { amount: p.feeAmount, currency: p.feeCurrency ?? p.currency }
                                  : null
                              }
                              today={ctx.today}
                              accounts={accountRows}
                              candidates={(salaryCandidates.get(p.currency) ?? []).map((c) => ({
                                id: c.id,
                                label: [
                                  fmt.date(c.occurredOn),
                                  c.counterparty ?? c.description ?? '—',
                                  fmt.amount(c.amount, p.currency),
                                ].join(' · '),
                              }))}
                            />
                          ) : p.status === 'paid' ? (
                            <span className="text-sm">
                              {t('salaryPaid')}
                              {transactions.map((x) => ` · ${fmt.date(x.occurredOn)}`).join('')}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {t('salarySkipped')}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Link href="/ledger/planned" className="mt-2 inline-block text-sm hover:underline">
                  {t('salaryPlanned')}
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {items.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}

      {GROUPS.map((g) => {
        const group = items.filter((i) => i.group === g);
        // Acts paid on their own while the rest of their payout is still open (A-085).
        const paidParts =
          g === 'paid'
            ? items
                .filter((i) => i.group !== 'paid')
                .flatMap((i) =>
                  i.acts.filter((a) => a.rateLocked && !a.isRest).map((a) => ({ i, a })),
                )
            : [];
        if (group.length === 0 && paidParts.length === 0) return null;
        const title = t(`groups.${g}`);
        return (
          <section key={g} className="flex flex-col gap-3" aria-label={title}>
            <h2 className="text-lg font-semibold">
              {title} ({group.length + paidParts.length})
            </h2>
            {paidParts.map(({ i, a }) => (
              <Card key={a.id} data-testid="paid-part">
                <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {i.personName} · {fmt.month(i.month)}
                  </span>
                  <Link className="hover:underline" href={`/acts/${a.id}`}>
                    {a.number ?? tp('draftAct')}
                  </Link>
                  {a.periodFrom && a.periodTo && (
                    <span className="text-muted-foreground">
                      {fmt.date(a.periodFrom)}–{fmt.date(a.periodTo)}
                    </span>
                  )}
                  <span>{fmt.amount(a.amountUah, 'UAH')}</span>
                  <Badge>{t('actPaid')}</Badge>
                  {i.remaining !== null && (
                    <span className="text-muted-foreground">
                      {t('paidPartRest', { amount: fmt.amount(i.remaining, i.currency) })}
                    </span>
                  )}
                </CardContent>
              </Card>
            ))}
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
                        {PAYOUT_METHOD_LABELS[i.item.payoutMethod] ?? i.item.payoutMethod} ·{' '}
                        {i.payeeName ?? t('noPayee')}
                        {i.nextDeadline && t('deadline', { date: fmt.date(i.nextDeadline) })}
                      </p>
                      {i.group !== 'paid' && (
                        <Badge variant="outline" className="mt-1" data-testid="next-step">
                          {t(`step.${nextStep(i)}`)}
                        </Badge>
                      )}
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
                    {isOwner &&
                      i.group !== 'paid' &&
                      toDecimal(i.item.paidAmount).isZero() &&
                      i.lines.every((l) => l.currency === 'USD') &&
                      i.adjustments.length === 0 &&
                      i.acts.every((a) => a.status === 'draft') && (
                        <ChangeMethodForm itemId={i.item.id} current={i.item.payoutMethod} />
                      )}
                    {billable(i) && (
                      <div
                        className="flex flex-wrap items-center gap-2 text-sm"
                        data-testid="contractor-invoice"
                      >
                        <span className="text-muted-foreground">{tci('label')}:</span>
                        {(() => {
                          const ci = contractorInvoices.find((x) => x.payrollItemId === i.item.id);
                          return ci ? (
                            <Link
                              className="hover:underline"
                              href={`/payroll/contractor-invoices/${ci.id}`}
                            >
                              {ci.number ?? tci('titleDraft')} ·{' '}
                              {fmt.amount(ci.amount, ci.currency)} ·{' '}
                              {DOC_STATUS_LABELS[ci.status] ?? ci.status}
                              {ci.status === 'issued' &&
                                ` · ${ci.signedAt ? t('signed') : t('unsigned')}`}
                            </Link>
                          ) : (
                            <DraftContractorInvoiceButton payrollItemId={i.item.id} />
                          );
                        })()}
                      </div>
                    )}
                    {i.acts.length > 0 && (
                      <ul className="flex flex-col gap-1 text-sm" data-testid="payout-acts">
                        {i.acts.map((a, n) => {
                          const next = i.acts[n + 1];
                          return (
                            <li key={a.id} className="flex flex-wrap items-center gap-2">
                              <Link className="hover:underline" href={`/acts/${a.id}`}>
                                {a.number ?? tp('draftAct')}
                              </Link>
                              <span className="text-muted-foreground">
                                {a.periodFrom && a.periodTo
                                  ? `${fmt.date(a.periodFrom)}–${fmt.date(a.periodTo)}`
                                  : ''}
                              </span>
                              <span>{fmt.amount(a.amountUah, 'UAH')}</span>
                              {a.status === 'issued' && (
                                <Badge variant={a.signed ? 'secondary' : 'outline'}>
                                  {a.signed ? t('signed') : t('unsigned')}
                                </Badge>
                              )}
                              {(i.group === 'paid' || (a.rateLocked && !a.isRest)) && (
                                <Badge>{t('actPaid')}</Badge>
                              )}
                              {(a.status === 'draft' || (a.status === 'issued' && !a.signed)) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  render={<Link href={`/acts/${a.id}`} />}
                                >
                                  {a.status === 'draft' ? t('actIssueLink') : t('actSignLink')}
                                </Button>
                              )}
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
                                (a.periodFrom < a.periodTo || !next) &&
                                (activitiesIn(i, a).length > 1 || splitsByAmount(i, a)) && (
                                  <SplitActForm
                                    actId={a.id}
                                    periodFrom={a.periodFrom}
                                    periodTo={a.periodTo}
                                    activities={activitiesIn(i, a)}
                                    byAmount={splitsByAmount(i, a)}
                                    extendable={!next}
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
                              {isOwner &&
                                toDecimal(i.item.paidAmount).isZero() &&
                                i.acts.every((a) => a.status === 'draft') && (
                                  <RemoveLineForm lineId={l.id} />
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
                    {isOwner &&
                      i.item.kind === 'person' &&
                      i.periodStatus === 'closed' &&
                      toDecimal(i.item.paidAmount).isZero() &&
                      i.acts.every((a) => a.status === 'draft') && (
                        <AdjustClosedForm
                          itemId={i.item.id}
                          fiat={fiat}
                          acts={[...i.acts]
                            .filter((a) => a.status === 'draft' && !a.rateLocked)
                            .sort((a, b) => Number(b.isRest) - Number(a.isRest))
                            .map((a) => ({
                              id: a.id,
                              label: `${a.periodFrom && a.periodTo ? `${fmt.date(a.periodFrom)}–${fmt.date(a.periodTo)}` : tp('draftAct')} · ${fmt.amount(a.amountUah, 'UAH')}`,
                            }))}
                        />
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
                        document={documentOf(i)}
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
