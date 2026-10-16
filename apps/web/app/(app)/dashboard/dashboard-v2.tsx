import { toDecimal } from '@tally/domain';
import { cn } from 'cn';
import { ArrowRight } from 'lucide-react';
import type { Result } from 'neverthrow';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/v2/help-tip';
import { PageHeader } from '@/components/v2/page-header';
import { Status } from '@/components/v2/status';
import { TabsNav } from '@/components/v2/tabs-nav';
import { getFormat } from '@/server/i18n';
import type { creditToClients } from '@/server/services/dashboard';
import type { monthMargin, sixMonthForecast } from '@/server/services/dashboard/margin';
import type { dashboardOverview } from '@/server/services/dashboard/overview';

type OkOf<T> = T extends Result<infer V, unknown> ? V : never;
type Okd<F extends (...a: never[]) => unknown> = OkOf<Awaited<ReturnType<F>>>;

const FORECAST_COLUMNS = [
  'revenueUsd',
  'payrollUsd',
  'agencyUsd',
  'plannedUsd',
  'chargesUsd',
] as const;
const FORECAST_LABELS = {
  revenueUsd: 'revenue',
  payrollUsd: 'payroll',
  agencyUsd: 'agency',
  plannedUsd: 'planned',
  chargesUsd: 'charges',
} as const;
const MARGIN_LABELS = { payUsd: 'pay', agencyUsd: 'agency', chargesUsd: 'charges' } as const;

export async function DashboardV2({
  o,
  c,
  m,
  forecast,
}: {
  o: Okd<typeof dashboardOverview.run>;
  c: Okd<typeof creditToClients.run> | null;
  m: Okd<typeof monthMargin.run> | null;
  forecast: (Okd<typeof sixMonthForecast.run>[number] & { cashUsd: string })[];
}) {
  const [t, tv, tc, tl, fmt] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('dashboard.v2'),
    getTranslations('common'),
    getTranslations('ledger'),
    getFormat(),
  ]);
  const usd = (v: string) => fmt.amount(v, 'USD');
  const unconverted = [...new Set([...o.unconverted, ...(m?.unconverted ?? [])])];
  const overdue = o.receivables.filter((r) => r.daysPastDue > 0);
  const columns = FORECAST_COLUMNS.filter((k) => forecast.some((r) => !toDecimal(r[k]).isZero()));
  const hidden = FORECAST_COLUMNS.length - columns.length;
  const marginColumns = (['payUsd', 'agencyUsd', 'chargesUsd'] as const).filter(
    (k) =>
      m !== null && [...m.byClient, ...m.byPerson, m.total].some((r) => !toDecimal(r[k]).isZero()),
  );
  const maxBar = forecast.reduce(
    (max, r) =>
      [toDecimal(r.netUsd).abs(), toDecimal(r.revenueUsd).abs()].reduce(
        (acc, v) => (v.gt(acc) ? v : acc),
        max,
      ),
    toDecimal('0'),
  );
  const barHeight = (v: string) =>
    maxBar.isZero() ? '0' : toDecimal(v).abs().div(maxBar).times(100).toFixed(0);

  const kpi = (
    label: ReactNode,
    value: string,
    testId: string,
    foot: ReactNode,
    href?: string,
    hero = false,
  ) => (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border p-4',
        hero ? 'border-transparent bg-[#0E0E11] text-[#FCFCFC] dark:bg-muted' : 'bg-card',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 text-sm',
          hero ? 'text-[#A3A3A3]' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div className="font-heading text-2xl font-bold tabular-nums" data-testid={testId}>
        {value}
      </div>
      <div className={cn('text-xs', hero ? 'text-[#A3A3A3]' : 'text-muted-foreground')}>
        {href ? (
          <Link
            href={href}
            className={cn('inline-flex items-center gap-1 hover:underline', !hero && 'text-link')}
          >
            {foot} <ArrowRight className="size-3" />
          </Link>
        ) : (
          foot
        )}
      </div>
    </div>
  );

  const panel = (title: ReactNode, body: ReactNode, aside?: ReactNode, className?: string) => (
    <section className={cn('flex min-w-0 flex-col rounded-lg border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 not-last:border-b">
        <h2 className="flex items-center gap-2 font-heading text-[17px] font-bold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {body && <div className="min-w-0 px-5 py-3">{body}</div>}
    </section>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} help={t('subtitle')}>
        <Button render={<Link href="/ledger/new" />}>+ {tl('v2.newTransaction')}</Button>
      </PageHeader>

      {unconverted.length > 0 && (
        <Alert>
          <AlertDescription>{t('noRate', { currencies: unconverted.join(', ') })}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpi(
          t('kpi.treasury'),
          usd(o.treasuryUsd),
          'treasury-total',
          tv('accounts', { count: o.balances.length }),
          '/ledger',
          true,
        )}
        {kpi(
          t('kpi.receivables'),
          usd(o.receivablesUsd),
          'receivables-total',
          overdue.length > 0
            ? tv('overdueCount', { count: overdue.length })
            : tv('invoices', { count: o.receivables.length }),
          '/invoices?status=issued',
        )}
        {kpi(
          t('kpi.payable'),
          usd(o.payableUsd),
          'payable-total',
          tv('toPayroll'),
          '/payroll?period=all',
        )}
        {kpi(
          <>
            {t('kpi.awaiting')}
            <HelpTip label={tc('help')}>{tv('awaitingHelp')}</HelpTip>
          </>,
          usd(o.awaitingUsd),
          'awaiting-total',
          <span>
            <Link href="/invoices?status=written_off" className="hover:underline">
              {t('kpi.badDebt')}: <span data-testid="bad-debt-total">{usd(o.badDebtUsd)}</span>
            </Link>
            {c && (
              <>
                {' · '}
                {t('creditTitle')}: <span data-testid="credit-to-clients">{usd(c.totalUsd)}</span>
              </>
            )}
          </span>,
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

      {panel(
        <>
          {tv('attention')}
          <Status tone={overdue.length > 0 ? 'danger' : 'neutral'}>{overdue.length}</Status>
        </>,
        overdue.length === 0 && (!c || c.rows.length === 0) ? (
          <p className="py-2 text-sm text-muted-foreground">{tv('allClear')}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {overdue.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <Status tone="danger">{t('overdue', { days: r.daysPastDue })}</Status>
                <span className="min-w-0 flex-1 truncate">
                  {r.clientName} · {r.number}
                </span>
                <span className="font-semibold tabular-nums">
                  {fmt.amount(r.remaining, r.currency)}
                </span>
                <Button size="sm" variant="outline" render={<Link href={`/invoices/${r.id}`} />}>
                  {tv('recordPayment')}
                </Button>
              </li>
            ))}
            {c?.rows.map((r) => (
              <li key={r.lineId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <Status tone="warning">{t('creditTitle')}</Status>
                <span className="min-w-0 flex-1 truncate">{r.personName}</span>
                <span className="font-semibold tabular-nums">
                  {r.amountUsd ? usd(r.amountUsd) : fmt.amount(r.amount, r.currency)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={`/invoices/${r.invoiceId}`} />}
                >
                  {t('invoice', { number: r.invoiceNumber ?? '' })}
                </Button>
              </li>
            ))}
          </ul>
        ),
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {panel(
          t('balances'),
          <ul className="flex flex-col divide-y text-sm">
            {o.balances
              .filter((b) => !b.hidden)
              .map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3 py-2">
                  <Link
                    href={`/ledger?accountId=${b.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {b.name}
                  </Link>
                  <span className="text-right tabular-nums">
                    <span className="font-medium">{fmt.amount(b.balance, b.currency)}</span>
                    {b.currency !== 'USD' && b.usd !== null && (
                      <span className="block text-xs text-muted-foreground">≈ {usd(b.usd)}</span>
                    )}
                  </span>
                </li>
              ))}
            {o.balances.some((b) => b.hidden) && (
              <li className="py-2">
                <Link
                  href="/ledger/accounts"
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {tv('hiddenAccounts', { count: o.balances.filter((b) => b.hidden).length })}
                </Link>
              </li>
            )}
          </ul>,
          <Link href="/ledger/reconcile" className="text-sm text-link hover:underline">
            {tl('reconcile')}
          </Link>,
        )}
        {panel(
          <>
            {t('calendar')}
            <HelpTip label={tc('help')}>{tv('calendarHelp')}</HelpTip>
          </>,
          o.events.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t('noEvents')}</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {o.events.map((e, i) => (
                <li
                  key={`${e.on}-${e.kind}-${String(i)}`}
                  data-testid="calendar-event"
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[5.5rem_10rem_minmax(0,1fr)_auto]"
                >
                  <span className="tabular-nums text-muted-foreground">{fmt.date(e.on)}</span>
                  <span className="hidden sm:block">
                    <Status>{t(`event.${e.kind}`)}</Status>
                  </span>
                  <Link href={e.href} className="min-w-0 truncate hover:underline">
                    {e.kind === 'invoice_date' || e.kind === 'act_date'
                      ? fmt.month(e.label)
                      : e.label}
                  </Link>
                  <span className="text-right tabular-nums">
                    {e.usd === null ? '' : usd(e.usd)}
                  </span>
                </li>
              ))}
            </ul>
          ),
          <span className="text-sm text-muted-foreground">
            {tv('ifNobodyPays')}{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {usd(o.cashAfterOutflowsUsd)}
            </span>
          </span>,
        )}
      </div>

      {panel(
        m ? t('marginTitle', { month: fmt.month(m.period.month) }) : t('marginEmpty'),
        m && (
          <div className="flex flex-col gap-4">
            <TabsNav
              label={t('marginMonths')}
              active={m.period.id}
              tabs={m.periods.map((p) => ({
                key: p.id,
                label: fmt.month(p.month),
                href: `/dashboard?margin=${p.id}`,
              }))}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              {(['byClient', 'byPerson'] as const).map((side) => (
                <div key={side} className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-2 text-left font-medium">{t(`margin.${side}`)}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('margin.revenue')}</th>
                        {marginColumns.map((k) => (
                          <th key={k} className="px-2 py-2 text-right font-medium">
                            {t(`margin.${MARGIN_LABELS[k]}`)}
                          </th>
                        ))}
                        <th className="py-2 pl-2 text-right font-medium">{t('margin.margin')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {m[side].map((r) => (
                        <tr key={r.id ?? 'internal'}>
                          <td className="py-2 pr-2">
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
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {fmt.amount(r.revenueUsd)}
                          </td>
                          {marginColumns.map((k) => (
                            <td key={k} className="px-2 py-2 text-right tabular-nums">
                              {fmt.amount(r[k])}
                            </td>
                          ))}
                          <td className="py-2 pl-2 text-right font-medium tabular-nums">
                            {fmt.amount(r.marginUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-semibold">
                        <td className="py-2 pr-2">{t('margin.total')}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {fmt.amount(m.total.revenueUsd)}
                        </td>
                        {marginColumns.map((k) => (
                          <td key={k} className="px-2 py-2 text-right tabular-nums">
                            {fmt.amount(m.total[k])}
                          </td>
                        ))}
                        <td
                          className="py-2 pl-2 text-right tabular-nums"
                          data-testid={`margin-total-${side}`}
                        >
                          {fmt.amount(m.total.marginUsd)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
            </div>
          </div>
        ),
      )}

      {panel(
        <>
          {t('forecast')}
          <HelpTip label={tc('help')}>{t('forecastDescription')}</HelpTip>
        </>,
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-6 items-end gap-2">
            {forecast.map((r) => {
              const net = toDecimal(r.netUsd);
              return (
                <div key={r.month} className="flex min-w-0 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end justify-center gap-1">
                    <div
                      title={`${t('forecastCol.revenue')} ${fmt.amount(r.revenueUsd)}`}
                      className="w-full max-w-6 rounded-t bg-foreground/15 dark:bg-foreground/25"
                      style={{ height: `${barHeight(r.revenueUsd)}%` }}
                    />
                    <div
                      title={`${t('forecastCol.net')} ${fmt.amount(r.netUsd)}`}
                      className={cn(
                        'w-full max-w-6 rounded-t',
                        net.isNegative() ? 'bg-danger-foreground/70' : 'bg-foreground dark:bg-neon',
                      )}
                      style={{ height: `${barHeight(r.netUsd)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium">{fmt.month(r.month).split(' ')[0]}</span>
                  <span className="hidden text-[11px] text-muted-foreground tabular-nums sm:block">
                    {tv('cashShort', { amount: fmt.amount(r.cashUsd) })}
                  </span>
                </div>
              );
            })}
          </div>
          <details className="group">
            <summary className="w-fit cursor-pointer list-none text-sm font-medium text-link hover:underline [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">{tv('showTable')}</span>
              <span className="hidden group-open:inline">{tv('hideTable')}</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-2 text-left font-medium">{t('forecastCol.month')}</th>
                    {columns.map((k) => (
                      <th key={k} className="px-2 py-2 text-right font-medium">
                        {t(`forecastCol.${FORECAST_LABELS[k]}`)}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium">{t('forecastCol.net')}</th>
                    <th className="py-2 pl-2 text-right font-medium">{t('forecastCol.cash')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {forecast.map((r) => (
                    <tr key={r.month} data-testid="forecast-month">
                      <td className="py-2 pr-2">{fmt.month(r.month)}</td>
                      {columns.map((k) => (
                        <td key={k} className="px-2 py-2 text-right tabular-nums">
                          {fmt.amount(r[k])}
                        </td>
                      ))}
                      <td
                        className={cn(
                          'px-2 py-2 text-right font-medium tabular-nums',
                          toDecimal(r.netUsd).isNegative() && 'text-danger-foreground',
                        )}
                      >
                        {fmt.amount(r.netUsd)}
                      </td>
                      <td className="py-2 pl-2 text-right tabular-nums">{fmt.amount(r.cashUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hidden > 0 && <p className="text-xs text-muted-foreground">{tv('zeroColumns')}</p>}
          </details>
        </div>,
        <span className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-sm bg-foreground/15 dark:bg-foreground/25"
            />
            {t('forecastCol.revenue')}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-foreground dark:bg-neon" />
            {t('forecastCol.net')}
          </span>
          <Link href="/ledger/planned" className="text-sm text-link hover:underline">
            {t('plannedLink')}
          </Link>
        </span>,
      )}
    </div>
  );
}
