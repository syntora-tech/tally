import { toDecimal } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { creditToClients } from '@/server/services/dashboard';
import { monthMargin, sixMonthForecast } from '@/server/services/dashboard/margin';
import { dashboardOverview } from '@/server/services/dashboard/overview';
import { getFormat, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('dashboard');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(ALL_ROLES);
  const finance = FINANCE_ROLES.includes(ctx.actor.role);
  const t = await getTranslations('dashboard');
  if (!finance) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('financeOnly')}</p>
      </div>
    );
  }
  const params = await searchParams;
  const marginPeriod = typeof params.margin === 'string' ? params.margin : '';
  const [overview, credit, margin, forecast, fmt] = await Promise.all([
    dashboardOverview.run(ctx, {}),
    creditToClients.run(ctx, {}),
    monthMargin.run(ctx, { periodId: marginPeriod }),
    sixMonthForecast.run(ctx, {}),
    getFormat(),
  ]);
  const o = overview.unwrapOr(null);
  const c = credit.unwrapOr(null);
  const m = margin.unwrapOr(null);
  const f = forecast.unwrapOr([]);
  if (!o) return null;
  const usd = (v: string | null) => (v === null ? '—' : fmt.amount(v, 'USD'));
  const forecastRows = f.map((row, i) => ({
    ...row,
    cashUsd: f
      .slice(0, i + 1)
      .reduce((sum, r) => sum.plus(r.netUsd), toDecimal(o.treasuryUsd))
      .toFixed(2),
  }));
  const unconverted = [...new Set([...o.unconverted, ...(m?.unconverted ?? [])])];

  const kpis = [
    { key: 'treasury', value: o.treasuryUsd, href: '/ledger', testId: 'treasury-total' },
    {
      key: 'receivables',
      value: o.receivablesUsd,
      href: '/invoices?status=issued',
      testId: 'receivables-total',
    },
    { key: 'awaiting', value: o.awaitingUsd, href: '/payroll', testId: 'awaiting-total' },
    { key: 'payable', value: o.payableUsd, href: '/payroll', testId: 'payable-total' },
    {
      key: 'badDebt',
      value: o.badDebtUsd,
      href: '/invoices?status=written_off',
      testId: 'bad-debt-total',
    },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      {unconverted.length > 0 && (
        <Alert>
          <AlertDescription>{t('noRate', { currencies: unconverted.join(', ') })}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Link key={k.key} href={k.href} className="rounded-xl border p-4 hover:bg-muted/50">
            <div className="text-sm text-muted-foreground">{t(`kpi.${k.key}`)}</div>
            <div className="text-xl font-semibold tabular-nums" data-testid={k.testId}>
              {fmt.amount(k.value, 'USD')}
            </div>
          </Link>
        ))}
        {c && (
          <div className="rounded-xl border p-4">
            <div className="text-sm text-muted-foreground">{t('creditTitle')}</div>
            <div className="text-xl font-semibold tabular-nums" data-testid="credit-to-clients">
              {fmt.amount(c.totalUsd, 'USD')}
            </div>
            {c.rows.length > 0 && (
              <ul className="mt-1 text-xs text-muted-foreground">
                {c.rows.map((r) => (
                  <li key={r.lineId}>
                    {r.personName} · {fmt.amount(r.amountUsd)} ·{' '}
                    <Link href={`/invoices/${r.invoiceId}`} className="underline">
                      {t('invoice', { number: r.invoiceNumber ?? '' })}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {o.shortfallOn && (
        <Alert variant="destructive" data-testid="cash-warning">
          <AlertDescription>
            {t('shortfall', {
              date: fmt.date(o.shortfallOn),
              amount: fmt.amount(o.cashAfterOutflowsUsd, 'USD'),
            })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('balances')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {o.balances.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/ledger?accountId=${b.id}`} className="hover:underline">
                        {b.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt.amount(b.balance, b.currency)}
                      {b.currency !== 'USD' && (
                        <div className="text-xs text-muted-foreground">≈ {usd(b.usd)}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('receivables')}</CardTitle>
          </CardHeader>
          <CardContent>
            {o.receivables.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noReceivables')}</p>
            ) : (
              <Table>
                <TableBody>
                  {o.receivables.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/invoices/${r.id}`} className="hover:underline">
                          {r.clientName} · {r.number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(r.remaining, r.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.daysPastDue > 0 ? (
                          <Badge variant="destructive">
                            {t('overdue', { days: r.daysPastDue })}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {t('dueIn', { days: -r.daysPastDue, date: fmt.date(r.dueDate) })}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('calendar')}</CardTitle>
          <CardDescription>
            {t('calendarDescription', { amount: fmt.amount(o.cashAfterOutflowsUsd, 'USD') })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {o.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noEvents')}</p>
          ) : (
            <Table>
              <TableBody>
                {o.events.map((e, i) => (
                  <TableRow key={`${e.on}-${e.kind}-${String(i)}`} data-testid="calendar-event">
                    <TableCell className="whitespace-nowrap">{fmt.date(e.on)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`event.${e.kind}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={e.href} className="hover:underline">
                        {e.kind === 'invoice_date' || e.kind === 'act_date'
                          ? fmt.month(e.label)
                          : e.label}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.usd === null ? '' : fmt.amount(e.usd, 'USD')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {m ? t('marginTitle', { month: fmt.month(m.period.month) }) : t('marginEmpty')}
          </CardTitle>
          {m && (
            <nav className="flex flex-wrap gap-2 text-sm" aria-label={t('marginMonths')}>
              {m.periods.map((p) => (
                <Link
                  key={p.id}
                  href={`/dashboard?margin=${p.id}`}
                  className={p.id === m.period.id ? 'font-semibold underline' : 'hover:underline'}
                >
                  {fmt.month(p.month)}
                </Link>
              ))}
            </nav>
          )}
        </CardHeader>
        {m && (
          <CardContent className="grid gap-6 xl:grid-cols-2">
            {(['byClient', 'byPerson'] as const).map((side) => (
              <Table key={side}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t(`margin.${side}`)}</TableHead>
                    <TableHead className="text-right">{t('margin.revenue')}</TableHead>
                    <TableHead className="text-right">{t('margin.pay')}</TableHead>
                    <TableHead className="text-right">{t('margin.agency')}</TableHead>
                    <TableHead className="text-right">{t('margin.margin')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m[side].map((r) => (
                    <TableRow key={r.id ?? 'internal'}>
                      <TableCell>
                        {r.id ? (
                          <Link
                            href={side === 'byClient' ? `/clients/${r.id}` : `/people/${r.id}`}
                            className="hover:underline"
                          >
                            {r.name}
                          </Link>
                        ) : (
                          t('internal')
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(r.revenueUsd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(r.payUsd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(r.agencyUsd)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {fmt.amount(r.marginUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium">{t('margin.total')}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt.amount(m.total.revenueUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt.amount(m.total.payUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt.amount(m.total.agencyUsd)}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      data-testid={`margin-total-${side}`}
                    >
                      {fmt.amount(m.total.marginUsd)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('forecast')}</CardTitle>
          <CardDescription>
            {t('forecastDescription')}{' '}
            <Link href="/ledger/planned" className="underline">
              {t('plannedLink')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('forecastCol.month')}</TableHead>
                <TableHead className="text-right">{t('forecastCol.revenue')}</TableHead>
                <TableHead className="text-right">{t('forecastCol.payroll')}</TableHead>
                <TableHead className="text-right">{t('forecastCol.agency')}</TableHead>
                <TableHead className="text-right">{t('forecastCol.planned')}</TableHead>
                <TableHead className="text-right">{t('forecastCol.net')}</TableHead>
                <TableHead className="text-right">{t('forecastCol.cash')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forecastRows.map((r) => (
                <TableRow key={r.month} data-testid="forecast-month">
                  <TableCell>{fmt.month(r.month)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.amount(r.revenueUsd)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.amount(r.payrollUsd)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.amount(r.agencyUsd)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.amount(r.plannedUsd)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {fmt.amount(r.netUsd)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt.amount(r.cashUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
