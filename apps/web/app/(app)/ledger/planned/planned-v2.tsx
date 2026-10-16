import { addMonths, startOfMonth } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DeletePaymentChargeButton, PaymentChargeForm } from '@/components/payment-charge-forms';
import { Button } from '@/components/ui/button';
import { ExpandableRow } from '@/components/v2/expandable-row';
import { DialogButton, RowMenu } from '@/components/v2/form-dialog';
import { EmptyState } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';
import { TabsNav } from '@/components/v2/tabs-nav';
import { feeLabel } from '@/lib/fee-label';
import { getFormat } from '@/server/i18n';
import type { requireRole } from '@/server/request-context';
import { listAccounts, listCategories } from '@/server/services/ledger';
import { listPlannedExpenses } from '@/server/services/planned';
import { listPlannedPayments, plannedPaymentCandidates } from '@/server/services/planned/payments';
import { peopleOptions } from '../../people/payees/people-options';
import { LedgerHeader } from '../ledger-v2';
import {
  DeletePlannedExpenseButton,
  DeletePlannedPartButton,
  PayPlannedForm,
  PlannedAmountForm,
  PlannedExpenseForm,
  PlannedPartForm,
  ResetAmountButton,
  SkipPlannedForm,
  UnlinkButton,
  UnskipButton,
} from './planned-forms';

/**
 * v2 planned expenses (A-104): the plan's form opens from the header, each payment has "Paid" as
 * its action and the rare ones under ⋯; a plan's parts and charges unfold under its row.
 */
export async function PlannedV2({
  ctx,
  tab,
}: {
  ctx: Awaited<ReturnType<typeof requireRole>>;
  tab: 'payments' | 'plans';
}) {
  const [t, tp, tch, tm, tc, fmt, categories, people] = await Promise.all([
    getTranslations('planned'),
    getTranslations('plannedPayments'),
    getTranslations('charges'),
    getTranslations('months'),
    getTranslations('common'),
    getFormat(),
    listCategories.run(ctx, {}),
    peopleOptions(ctx),
  ]);
  const thisMonth = ctx.today.slice(0, 7);
  const expenseCategories = categories
    .unwrapOr([])
    .filter((c) => c.txType === 'expense')
    .map((c) => ({ value: c.id, label: c.name }));
  const header = (
    <div className="flex flex-col gap-4">
      <LedgerHeader section="planned" title={t('title')} help={`${t('subtitle')}. ${tp('window')}`}>
        <DialogButton
          size="default"
          wide
          title={t('new')}
          content={
            <PlannedExpenseForm
              categories={expenseCategories}
              people={people}
              thisMonth={thisMonth}
            />
          }
        >
          + {t('v2.newPlan')}
        </DialogButton>
      </LedgerHeader>
      <TabsNav
        label={t('title')}
        active={tab}
        tabs={[
          { key: 'payments', label: tp('tab'), href: '/ledger/planned' },
          { key: 'plans', label: t('tab'), href: '/ledger/planned?tab=plans' },
        ]}
      />
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
      .filter(({ account: a }) => a.isActive && !a.isHidden)
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
    const status = (r: (typeof rows)[number]) =>
      r.payment.status === 'paid' ? (
        <Status tone="success">{tp('status.paid')}</Status>
      ) : r.payment.status === 'skipped' ? (
        <Status>{tp('status.skipped')}</Status>
      ) : r.overdue ? (
        <Status tone="danger">{tp('status.overdue')}</Status>
      ) : (
        <Status tone="warning">{tp('status.due')}</Status>
      );

    return (
      <div className="flex flex-col gap-5">
        {header}
        {ordered.length === 0 ? (
          <EmptyState
            title={tp('empty')}
            action={
              <Button variant="outline" render={<Link href="/ledger/planned?tab=plans" />}>
                {t('tab')}
              </Button>
            }
          />
        ) : (
          <section className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[48rem] text-sm" data-testid="planned-payments">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-normal">{tp('dueOn')}</th>
                  <th className="px-3 py-2.5 text-left font-normal">{tp('payment')}</th>
                  <th className="px-3 py-2.5 text-right font-normal">{tp('toPay')}</th>
                  <th className="px-3 py-2.5 text-right font-normal">{tp('feeColumn')}</th>
                  <th className="px-3 py-2.5 text-left font-normal">{tp('statusColumn')}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => {
                  const p = r.payment;
                  const isCharge = p.parentId !== null || p.sourceAllocationId !== null;
                  const isInstalment = p.plannedExpenseId !== null && p.chargeId === null;
                  const fee = p.feeAmount
                    ? { amount: p.feeAmount, currency: p.feeCurrency ?? p.currency }
                    : null;
                  return (
                    <tr key={p.id} data-testid="planned-payment" className="border-t align-top">
                      <td className="px-5 py-3 whitespace-nowrap tabular-nums">
                        {fmt.date(p.dueOn)}
                      </td>
                      <td className={isCharge ? 'py-3 pr-3 pl-8' : 'px-3 py-3'}>
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
                              className="text-link hover:underline"
                            >
                              {fmt.date(l.occurredOn)} · {fmt.amount(l.amount, l.currency)}
                            </Link>
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold whitespace-nowrap tabular-nums">
                        {fmt.amount(p.amount, p.currency)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                        {fee ? fmt.amount(fee.amount, fee.currency) : '—'}
                      </td>
                      <td className="px-3 py-3">{status(r)}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'due' && (
                            <>
                              <DialogButton
                                title={p.name}
                                description={fmt.amount(p.amount, p.currency)}
                                content={
                                  <PayPlannedForm
                                    id={p.id}
                                    amount={p.amount}
                                    currency={p.currency}
                                    fee={fee}
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
                                }
                              >
                                {tp('pay')}
                              </DialogButton>
                              {p.amountOverridden && <ResetAmountButton id={p.id} />}
                              <RowMenu
                                label={tc('actions')}
                                entries={[
                                  {
                                    label: `${isInstalment ? tp('setGross') : tp('setAmount')}…`,
                                    dialog: {
                                      title: p.name,
                                      content: (
                                        <PlannedAmountForm
                                          id={p.id}
                                          isInstalment={isInstalment}
                                          amount={p.amount}
                                          gross={p.gross}
                                          currency={p.currency}
                                        />
                                      ),
                                    },
                                  },
                                  {
                                    label: `${tp('skip')}…`,
                                    dialog: {
                                      title: p.name,
                                      content: <SkipPlannedForm id={p.id} />,
                                    },
                                  },
                                ]}
                              />
                            </>
                          )}
                          {p.status === 'paid' && <UnlinkButton id={p.id} />}
                          {p.status === 'skipped' && <UnskipButton id={p.id} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    );
  }

  const rows = (await listPlannedExpenses.run(ctx, {})).unwrapOr([]);
  const schedule = (r: { frequency: string; anchorMonth: number | null; dueDay: number | null }) =>
    r.frequency === 'monthly'
      ? t('scheduleMonthly', { day: r.dueDay ?? 1 })
      : t(r.frequency === 'yearly' ? 'scheduleYearly' : 'scheduleQuarterly', {
          day: r.dueDay ?? 1,
          month: tm(String(r.anchorMonth ?? 1) as '1'),
        });

  return (
    <div className="flex flex-col gap-5">
      {header}
      {rows.length === 0 ? (
        <EmptyState title={t('v2.noPlans')}>{t('v2.noPlansHint')}</EmptyState>
      ) : (
        <section className="rounded-lg border bg-card">
          {rows.map(({ expense: e, categoryName, personName, nextOn, parts, charges }) => (
            <ExpandableRow
              key={e.id}
              testId="planned-expense"
              label={t('v2.details', { name: e.name })}
              summary={
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{e.name}</span>
                    <span className="font-semibold tabular-nums">
                      {fmt.amount(e.amount, e.currency)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      schedule(e),
                      nextOn ? t('next', { date: fmt.date(nextOn) }) : t('noNext'),
                      categoryName,
                      personName,
                      e.counterparty,
                      feeLabel(e, fmt, e.currency) &&
                        t('feeIs', { fee: feeLabel(e, fmt, e.currency) ?? '' }),
                      parts.length ? t('v2.partsCount', { count: parts.length }) : null,
                      charges.length ? t('v2.chargesCount', { count: charges.length }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              }
              actions={
                <>
                  <DialogButton
                    variant="outline"
                    wide
                    title={e.name}
                    content={
                      <PlannedExpenseForm
                        categories={expenseCategories}
                        people={people}
                        thisMonth={thisMonth}
                        value={e}
                      />
                    }
                  >
                    {tc('edit')}
                  </DialogButton>
                  <DeletePlannedExpenseButton id={e.id} />
                </>
              }
            >
              <div className="flex flex-col gap-5 pt-2">
                <section className="flex flex-col gap-2">
                  <h3 className="font-heading text-sm font-bold">{t('parts')}</h3>
                  <p className="text-xs text-muted-foreground">{t('partsHint')}</p>
                  {parts.map((part) => (
                    <div
                      key={part.id}
                      className="flex items-start gap-2 rounded-md border bg-card p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <PlannedPartForm expenseId={e.id} value={part} />
                      </div>
                      <DeletePlannedPartButton id={part.id} />
                    </div>
                  ))}
                  <div className="rounded-md border border-dashed bg-card p-3">
                    <PlannedPartForm expenseId={e.id} />
                  </div>
                </section>
                <section className="flex flex-col gap-2">
                  <h3 className="font-heading text-sm font-bold">{tch('title')}</h3>
                  <p className="text-xs text-muted-foreground">{tch('plannedHint')}</p>
                  {charges.map(({ charge }) => (
                    <div
                      key={charge.id}
                      className="flex items-start gap-2 rounded-md border bg-card p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <PaymentChargeForm
                          target={{ plannedExpenseId: e.id }}
                          value={charge}
                          categories={expenseCategories}
                          thisMonth={thisMonth}
                        />
                      </div>
                      <DeletePaymentChargeButton id={charge.id} />
                    </div>
                  ))}
                  <div className="rounded-md border border-dashed bg-card p-3">
                    <PaymentChargeForm
                      target={{ plannedExpenseId: e.id }}
                      categories={expenseCategories}
                      thisMonth={thisMonth}
                    />
                  </div>
                </section>
              </div>
            </ExpandableRow>
          ))}
        </section>
      )}
    </div>
  );
}
