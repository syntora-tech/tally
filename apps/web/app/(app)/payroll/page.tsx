import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
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
import { ADJUSTMENT_KIND_LABELS, FX_SOURCE_LABELS } from '@/lib/labels';
import { monthTitle } from '@/lib/months';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { suggestRate } from '@/server/services/fx';
import { listAccounts } from '@/server/services/ledger';
import { listPayroll, type PayrollGroup } from '@/server/services/payroll';
import { listPeriods } from '@/server/services/periods';
import { OverrideForm, PayDialog } from './payroll-forms';

export const metadata: Metadata = { title: 'Виплати · Tally' };

const LINE_STATUS: Record<string, string> = {
  accrued: 'нараховано',
  awaiting_client: 'чекає клієнта',
  payable: 'можна виплатити',
  paid: 'виплачено',
};

const GROUPS: { key: PayrollGroup; title: string }[] = [
  { key: 'ready', title: 'Можна виплатити зараз' },
  { key: 'waiting', title: 'Чекає оплати клієнта' },
  { key: 'paid', title: 'Виплачено' },
];

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
  const accountRows = accounts.unwrapOr([]).map(({ account: a, balance }) => ({
    id: a.id,
    currency: a.currency,
    label: `${a.name} · ${formatAmount(balance, a.currency)}`,
  }));
  const isOwner = ctx.actor.role === 'owner';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Виплати</h1>
          <p className="text-muted-foreground">
            Pay-when-paid: рядок стає доступним після повної оплати клієнтом або в дедлайн за
            рахунок компанії
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Період">
          <Button size="sm" variant="secondary" render={<Link href="/payroll/acts" />}>
            Реєстр актів
          </Button>
          <Button
            size="sm"
            variant={periodId ? 'outline' : 'default'}
            render={<Link href="/payroll" />}
          >
            Усі
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
                {monthTitle(p.month)}
              </Button>
            ))}
        </nav>
      </div>

      {items.length === 0 && (
        <p className="text-muted-foreground">
          Виплат ще немає — вони створюються при закритті періоду
        </p>
      )}

      {GROUPS.map((g) => {
        const group = items.filter((i) => i.group === g.key);
        if (group.length === 0) return null;
        return (
          <section key={g.key} className="flex flex-col gap-3" aria-label={g.title}>
            <h2 className="text-lg font-semibold">
              {g.title} ({group.length})
            </h2>
            {group.map((i) => {
              const fiat = i.item.payoutMethod === 'fiat';
              return (
                <Card key={i.item.id} data-testid="payroll-item">
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {i.personName} · {monthTitle(i.month)}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {fiat ? 'fiat' : 'crypto'} · {i.payeeName ?? 'одержувача не вказано'}
                        {i.nextDeadline &&
                          ` · дедлайн ${formatUaDate(i.nextDeadline as LocalDate)}`}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-medium">{formatAmount(i.item.totalUsd, 'USD')}</div>
                      {fiat && (
                        <div>
                          {i.item.totalUah
                            ? formatAmount(i.item.totalUah, 'UAH')
                            : 'курс не задано'}
                          {i.item.fxSource && (
                            <Badge variant="outline" className="ml-2">
                              {i.item.payoutFxRate} · {FX_SOURCE_LABELS[i.item.fxSource]}
                            </Badge>
                          )}
                        </div>
                      )}
                      {i.remaining !== null && i.group !== 'paid' && (
                        <div className="text-muted-foreground">
                          залишок {formatAmount(i.remaining, i.currency)}
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Робота</TableHead>
                          <TableHead>USD</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Фінансування</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {i.lines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>
                              {l.clientName ?? 'внутрішнє'}
                              {l.invoiceNumber && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  · інвойс {l.invoiceNumber}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{formatAmount(l.amountUsd)}</TableCell>
                            <TableCell>
                              {LINE_STATUS[l.status]}
                              {l.status === 'awaiting_client' && l.deadline && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  до {formatUaDate(l.deadline)}
                                </span>
                              )}
                              {l.overrideReason && (
                                <div className="text-xs text-muted-foreground">
                                  розблоковано: {l.overrideReason}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {l.fundingSource === 'client'
                                ? 'клієнт'
                                : l.fundingSource === 'company'
                                  ? 'компанія'
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
                            {ADJUSTMENT_KIND_LABELS[a.kind]}: {formatAmount(a.amount, a.currency)} —{' '}
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
