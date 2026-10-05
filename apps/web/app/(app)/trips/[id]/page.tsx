import { addDays, toDecimal, type LocalDate } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listAccounts } from '@/server/services/ledger';
import { listPayees } from '@/server/services/payees';
import { searchPeople } from '@/server/services/people';
import { listPeriods } from '@/server/services/periods';
import { getTrip, tripLedgerCandidates } from '@/server/services/trips';
import { getFormat, pageTitle } from '@/server/i18n';
import {
  DeleteExpenseButton,
  ExpenseForm,
  PayReimbursementForm,
  ReimbursementForm,
} from './trip-forms';

export const generateMetadata = pageTitle('trip');

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(ALL_ROLES);
  const finance = FINANCE_ROLES.includes(ctx.actor.role);
  const { id } = await params;
  const result = await getTrip.run(ctx, { id });
  if (result.isErr()) notFound();
  const { trip, participants, expenses, reimbursements, summary, status, acts } = result.value;
  const [t, fmt] = await Promise.all([getTranslations('trips'), getFormat()]);
  const since = addDays((trip.startsOn ?? ctx.today) as LocalDate, -60);
  const [accounts, candidates, periods, payees, people] = finance
    ? await Promise.all([
        listAccounts.run(ctx, {}),
        tripLedgerCandidates.run(ctx, { since }),
        listPeriods.run(ctx, {}),
        listPayees.run(ctx, {}),
        searchPeople.run(ctx, {}),
      ])
    : [];
  const name = (personId: string) => participants.find((p) => p.personId === personId)?.name ?? '';
  const accountOptions = (accounts?.unwrapOr([]) ?? []).map(({ account: a }) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
    currency: a.currency,
  }));
  const candidateRows = candidates?.unwrapOr([]) ?? [];
  const candidateLabel = (c: (typeof candidateRows)[number], amount: string) =>
    [
      fmt.date(c.occurredOn),
      c.description ?? c.counterparty ?? '—',
      c.accountName,
      fmt.amount(amount, c.currency),
    ].join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/trips" className="text-sm text-muted-foreground hover:underline">
            ← {t('title')}
          </Link>
          <h1 className="text-2xl font-semibold">{trip.title}</h1>
          <p className="text-muted-foreground">
            {[
              trip.location,
              trip.startsOn && trip.endsOn
                ? `${fmt.date(trip.startsOn)} — ${fmt.date(trip.endsOn)}`
                : t('noDates'),
              participants.map((p) => p.name).join(', '),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <Badge variant="outline" className="mt-1" data-testid="trip-status">
            {t(`status.${status}`)}
          </Badge>
        </div>
        {finance && (
          <Button variant="outline" render={<Link href={`/trips/${trip.id}/edit`} />}>
            {t('edit')}
          </Button>
        )}
      </div>
      {trip.notes && <p className="text-sm whitespace-pre-line">{trip.notes}</p>}

      {finance && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('summary')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('expense.person')}</TableHead>
                    <TableHead className="text-right">{t('sum.spent')}</TableHead>
                    <TableHead className="text-right">{t('sum.toReimburse')}</TableHead>
                    <TableHead className="text-right">{t('sum.reimbursed')}</TableHead>
                    <TableHead className="text-right">{t('sum.remaining')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s) => (
                    <TableRow key={s.personId} data-testid="trip-summary">
                      <TableCell>{name(s.personId)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(s.spentUah, 'UAH')}
                        <div className="text-xs text-muted-foreground">
                          {fmt.amount(s.spentUsd, 'USD')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(s.toReimburseUah, 'UAH')}
                        <div className="text-xs text-muted-foreground">
                          {fmt.amount(s.toReimburseUsd, 'USD')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(s.reimbursedUah, 'UAH')}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {fmt.amount(s.remainingUah, 'UAH')}
                        <div className="text-xs text-muted-foreground">
                          {fmt.amount(s.remainingUsd, 'USD')}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('expenses')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {expenses.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('expense.date')}</TableHead>
                        <TableHead>{t('expense.person')}</TableHead>
                        <TableHead>{t('expense.description')}</TableHead>
                        <TableHead className="text-right">{t('expense.amount')}</TableHead>
                        <TableHead className="text-right">UAH / USD</TableHead>
                        <TableHead>{t('expense.paidBy')}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map(({ expense: e, receiptKey }) => (
                        <TableRow key={e.id} data-testid="trip-expense">
                          <TableCell className="whitespace-nowrap">
                            {e.spentOn ? fmt.date(e.spentOn) : '—'}
                          </TableCell>
                          <TableCell>{name(e.personId)}</TableCell>
                          <TableCell>
                            {e.description}
                            {receiptKey && e.receiptDocumentId && (
                              <a
                                href={`/api/files/${e.receiptDocumentId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 text-xs underline"
                              >
                                {t('receipt')}
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt.amount(e.amount, e.currency)}
                            <div className="text-xs text-muted-foreground">
                              {t('rate', { rate: toDecimal(e.fxRate).toString() })}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt.amount(e.amountUah, 'UAH')}
                            <div className="text-xs text-muted-foreground">
                              {fmt.amount(toDecimal(e.amountUsd).toFixed(2), 'USD')}
                            </div>
                          </TableCell>
                          <TableCell>
                            {e.paidBy === 'company' ? t('paidBy.company') : t('paidBy.person')}
                            {e.paidBy === 'person' && !e.reimbursable && (
                              <div className="text-xs text-muted-foreground">
                                {t('notReimbursed')}
                              </div>
                            )}
                            {e.transactionId && (
                              <div className="text-xs">
                                <Link
                                  href={`/ledger/${e.transactionId}/edit`}
                                  className="underline"
                                >
                                  Ledger
                                </Link>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <DeleteExpenseButton id={e.id} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <ExpenseForm
                tripId={trip.id}
                people={participants.map((p) => ({ value: p.personId, label: p.name }))}
                defaultDate={trip.startsOn ?? ctx.today}
                accounts={accountOptions}
                candidates={candidateRows
                  .filter((c) => !c.linked)
                  .map((c) => ({ value: c.id, label: candidateLabel(c, c.amount) }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reimbursements')}</CardTitle>
              <CardDescription>{t('reimbursementsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {reimbursements.map((r) => {
                const act = acts.find((a) => a.reimbursementId === r.id);
                const left = toDecimal(r.amount).minus(r.paidUah).toFixed(2);
                return (
                  <div
                    key={r.id}
                    className="flex flex-col gap-2 rounded-md border p-3"
                    data-testid="reimbursement"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{name(r.personId)}</span>
                      <span className="tabular-nums">{fmt.amount(r.amount, 'UAH')}</span>
                      <Badge variant="outline">{t(`method.${r.method as 'act'}`)}</Badge>
                      <Badge variant={r.paid ? 'secondary' : 'outline'}>
                        {r.paid
                          ? t('reimbursementState.paid')
                          : t('reimbursementState.planned', {
                              amount: fmt.amount(r.paidUah, 'UAH'),
                            })}
                      </Badge>
                      {act && (
                        <Link href={`/payroll/acts/${act.id}`} className="underline">
                          {act.number ? t('act', { number: act.number }) : t('actDraft')}
                        </Link>
                      )}
                      {r.notes && <span className="text-muted-foreground">{r.notes}</span>}
                    </div>
                    {!r.paid && r.method !== 'payroll' && (
                      <PayReimbursementForm
                        reimbursementId={r.id}
                        remaining={left}
                        today={ctx.today}
                        accounts={accountOptions.filter((a) => a.currency === 'UAH')}
                        candidates={candidateRows
                          .filter((c) => c.currency === 'UAH' && toDecimal(c.remaining).gt(0))
                          .map((c) => ({ value: c.id, label: candidateLabel(c, c.remaining) }))}
                      />
                    )}
                  </div>
                );
              })}
              {participants.length > 0 && (
                <ReimbursementForm
                  tripId={trip.id}
                  today={ctx.today}
                  people={participants.map((p) => {
                    const owed = toDecimal(
                      summary.find((s) => s.personId === p.personId)?.remainingUah ?? '0',
                    ).minus(
                      reimbursements
                        .filter((r) => r.personId === p.personId && !r.paid)
                        .reduce(
                          (s, r) => s.plus(toDecimal(r.amount).minus(r.paidUah)),
                          toDecimal('0'),
                        ),
                    );
                    return {
                      value: p.personId,
                      label: p.name,
                      remaining: owed.gt(0) ? owed.toFixed(2) : '',
                      payeeId:
                        people?.unwrapOr([]).find((x) => x.id === p.personId)?.defaultPayeeId ??
                        null,
                    };
                  })}
                  periods={(periods?.unwrapOr([]) ?? [])
                    .filter(({ period: x }) => x.status === 'open')
                    .map(({ period: x }) => ({ value: x.id, label: fmt.month(x.month) }))}
                  payees={(payees?.unwrapOr([]) ?? [])
                    .filter((x) => x.kind !== 'crypto')
                    .map((x) => ({ value: x.id, label: x.name }))}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <LinkedDocuments ctx={ctx} entityType="trip" entityId={trip.id} canAdd={finance} />
        <AuditHistory ctx={ctx} tableName="trip" rowId={trip.id} />
      </div>
    </div>
  );
}
