import { getTranslations } from 'next-intl/server';
import { addMonths, startOfMonth } from '@tally/domain';
import Link from 'next/link';
import { DeletePaymentChargeButton, PaymentChargeForm } from '@/components/payment-charge-forms';
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
import { feeLabel } from '@/lib/fee-label';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listAccounts, listCategories } from '@/server/services/ledger';
import { listPlannedExpenses } from '@/server/services/planned';
import { listPlannedPayments, plannedPaymentCandidates } from '@/server/services/planned/payments';
import { getFormat, pageTitle } from '@/server/i18n';
import { peopleOptions } from '../../people/payees/people-options';
import {
  DeletePlannedExpenseButton,
  DeletePlannedPartButton,
  PaymentActions,
  PlannedExpenseForm,
  PlannedPartForm,
  ResetAmountButton,
  UnlinkButton,
  UnskipButton,
} from './planned-forms';

export const generateMetadata = pageTitle('planned');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PlannedExpensesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const tab = (await searchParams).tab === 'plans' ? 'plans' : 'payments';
  const [t, tp, tch, tm, fmt] = await Promise.all([
    getTranslations('planned'),
    getTranslations('plannedPayments'),
    getTranslations('charges'),
    getTranslations('months'),
    getFormat(),
  ]);
  const thisMonth = ctx.today.slice(0, 7);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <nav className="flex gap-2">
        <Button
          size="sm"
          variant={tab === 'payments' ? 'default' : 'outline'}
          render={<Link href="/ledger/planned" />}
        >
          {tp('tab')}
        </Button>
        <Button
          size="sm"
          variant={tab === 'plans' ? 'default' : 'outline'}
          render={<Link href="/ledger/planned?tab=plans" />}
        >
          {t('tab')}
        </Button>
      </nav>
    </div>
  );

  if (tab === 'payments') {
    const [payments, accounts] = await Promise.all([
      listPlannedPayments.run(ctx, {}),
      listAccounts.run(ctx, {}),
    ]);
    const rows = payments.unwrapOr([]);
    const accountRows = accounts
      .unwrapOr([])
      .filter(({ account: a }) => a.isActive)
      .map(({ account: a, balance }) => ({
        id: a.id,
        currency: a.currency,
        label: `${a.name} · ${fmt.amount(balance, a.currency)}`,
      }));
    const currencies = [
      ...new Set(rows.filter((r) => r.payment.status === 'due').map((r) => r.payment.currency)),
    ];
    const since = addMonths(startOfMonth(ctx.today), -1);
    const until = addMonths(startOfMonth(ctx.today), 2);
    const candidates = new Map(
      await Promise.all(
        currencies.map(
          async (currency) =>
            [
              currency,
              (await plannedPaymentCandidates.run(ctx, { currency, since, until })).unwrapOr([]),
            ] as const,
        ),
      ),
    );
    const parents = rows.filter((r) => r.payment.parentId === null);
    const childrenOf = (id: string) => rows.filter((r) => r.payment.parentId === id);
    const ordered = parents.flatMap((r) => [r, ...childrenOf(r.payment.id)]);
    const statusBadge = (r: (typeof rows)[number]) =>
      r.payment.status === 'paid' ? (
        <Badge>{tp('status.paid')}</Badge>
      ) : r.payment.status === 'skipped' ? (
        <Badge variant="outline">{tp('status.skipped')}</Badge>
      ) : r.overdue ? (
        <Badge variant="destructive">{tp('status.overdue')}</Badge>
      ) : (
        <Badge variant="secondary">{tp('status.due')}</Badge>
      );

    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-sm text-muted-foreground">{tp('window')}</p>
        {ordered.length === 0 ? (
          <p className="text-muted-foreground">{tp('empty')}</p>
        ) : (
          <Table data-testid="planned-payments">
            <TableHeader>
              <TableRow>
                <TableHead>{tp('dueOn')}</TableHead>
                <TableHead>{tp('payment')}</TableHead>
                <TableHead className="text-right">{tp('toPay')}</TableHead>
                <TableHead className="text-right">{tp('feeColumn')}</TableHead>
                <TableHead>{tp('statusColumn')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((r) => {
                const p = r.payment;
                const isCharge = p.parentId !== null || p.sourceAllocationId !== null;
                const isInstalment = p.plannedExpenseId !== null && p.chargeId === null;
                return (
                  <TableRow key={p.id} data-testid="planned-payment">
                    <TableCell className="whitespace-nowrap">{fmt.date(p.dueOn)}</TableCell>
                    <TableCell className={isCharge ? 'pl-8' : ''}>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          fmt.month(p.month),
                          r.personName,
                          p.counterparty,
                          r.categoryName,
                          p.gross && (isInstalment || p.sourceAllocationId)
                            ? tp('grossOf', { amount: fmt.amount(p.gross, p.currency) })
                            : null,
                          p.amountOverridden ? tp('setByHand') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      {p.skipReason && (
                        <div className="text-xs text-muted-foreground">{p.skipReason}</div>
                      )}
                      {r.transactions.map((l) => (
                        <div key={l.allocationId} className="text-xs">
                          <Link
                            href={`/ledger/${l.transactionId}/edit`}
                            className="hover:underline"
                          >
                            {fmt.date(l.occurredOn)} · {fmt.amount(l.amount, l.currency)}
                          </Link>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {fmt.amount(p.amount, p.currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {p.feeAmount ? fmt.amount(p.feeAmount, p.feeCurrency ?? p.currency) : '—'}
                    </TableCell>
                    <TableCell>{statusBadge(r)}</TableCell>
                    <TableCell>
                      {p.status === 'due' && (
                        <div className="flex flex-col gap-1">
                          <PaymentActions
                            id={p.id}
                            isInstalment={isInstalment}
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
                            candidates={(candidates.get(p.currency) ?? []).map((c) => ({
                              id: c.id,
                              label: [
                                fmt.date(c.occurredOn),
                                c.counterparty ?? c.description ?? '—',
                                fmt.amount(c.amount, p.currency),
                              ].join(' · '),
                            }))}
                          />
                          {p.amountOverridden && <ResetAmountButton id={p.id} />}
                        </div>
                      )}
                      {p.status === 'paid' && <UnlinkButton id={p.id} />}
                      {p.status === 'skipped' && <UnskipButton id={p.id} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    );
  }

  const [rows, categories, people] = await Promise.all([
    listPlannedExpenses.run(ctx, {}),
    listCategories.run(ctx, {}),
    peopleOptions(ctx),
  ]);
  const expenseCategories = categories
    .unwrapOr([])
    .filter((c) => c.txType === 'expense')
    .map((c) => ({ value: c.id, label: c.name }));
  const schedule = (r: { frequency: string; anchorMonth: number | null; dueDay: number | null }) =>
    r.frequency === 'monthly'
      ? t('scheduleMonthly', { day: r.dueDay ?? 1 })
      : t(r.frequency === 'yearly' ? 'scheduleYearly' : 'scheduleQuarterly', {
          day: r.dueDay ?? 1,
          month: tm(String(r.anchorMonth ?? 1) as '1'),
        });

  return (
    <div className="flex flex-col gap-6">
      {header}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlannedExpenseForm
            categories={expenseCategories}
            people={people}
            thisMonth={thisMonth}
          />
        </CardContent>
      </Card>
      {rows.unwrapOr([]).map(({ expense: e, categoryName, personName, nextOn, parts, charges }) => (
        <Card key={e.id} data-testid="planned-expense">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                {e.name} · {fmt.amount(e.amount, e.currency)}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {[
                  categoryName,
                  personName,
                  e.counterparty,
                  schedule(e),
                  nextOn ? t('next', { date: fmt.date(nextOn) }) : t('noNext'),
                  feeLabel(e, fmt, e.currency) &&
                    t('feeIs', { fee: feeLabel(e, fmt, e.currency) ?? '' }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <DeletePlannedExpenseButton id={e.id} />
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <PlannedExpenseForm
              categories={expenseCategories}
              people={people}
              thisMonth={thisMonth}
              value={e}
            />
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{t('parts')}</h3>
              <p className="text-xs text-muted-foreground">{t('partsHint')}</p>
              {parts.map((part) => (
                <div key={part.id} className="flex items-end gap-2">
                  <PlannedPartForm expenseId={e.id} value={part} />
                  <DeletePlannedPartButton id={part.id} />
                </div>
              ))}
              <PlannedPartForm expenseId={e.id} />
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{tch('title')}</h3>
              <p className="text-xs text-muted-foreground">{tch('plannedHint')}</p>
              {charges.map(({ charge }) => (
                <div key={charge.id} className="flex items-end gap-2">
                  <PaymentChargeForm
                    target={{ plannedExpenseId: e.id }}
                    value={charge}
                    categories={expenseCategories}
                    thisMonth={thisMonth}
                  />
                  <DeletePaymentChargeButton id={charge.id} />
                </div>
              ))}
              <PaymentChargeForm
                target={{ plannedExpenseId: e.id }}
                categories={expenseCategories}
                thisMonth={thisMonth}
              />
            </section>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
