import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listCategories } from '@/server/services/ledger';
import { listPlannedExpenses } from '@/server/services/planned';
import { getFormat, pageTitle } from '@/server/i18n';
import { DeletePlannedExpenseButton, PlannedExpenseForm } from './planned-forms';

export const generateMetadata = pageTitle('planned');

export default async function PlannedExpensesPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const [rows, categories, t, tm, fmt] = await Promise.all([
    listPlannedExpenses.run(ctx, {}),
    listCategories.run(ctx, {}),
    getTranslations('planned'),
    getTranslations('months'),
    getFormat(),
  ]);
  const expenseCategories = categories
    .unwrapOr([])
    .filter((c) => c.txType === 'expense')
    .map((c) => ({ value: c.id, label: c.name }));
  const thisMonth = ctx.today.slice(0, 7);
  const schedule = (r: { frequency: string; anchorMonth: number | null; dueDay: number | null }) =>
    r.frequency === 'monthly'
      ? t('scheduleMonthly', { day: r.dueDay ?? 1 })
      : t(r.frequency === 'yearly' ? 'scheduleYearly' : 'scheduleQuarterly', {
          day: r.dueDay ?? 1,
          month: tm(String(r.anchorMonth ?? 1) as '1'),
        });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlannedExpenseForm categories={expenseCategories} thisMonth={thisMonth} />
        </CardContent>
      </Card>
      {rows.unwrapOr([]).map(({ expense: e, categoryName, nextOn }) => (
        <Card key={e.id} data-testid="planned-expense">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                {e.name} · {fmt.amount(e.amount, e.currency)}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {categoryName} · {schedule(e)} ·{' '}
                {nextOn ? t('next', { date: fmt.date(nextOn) }) : t('noNext')}
              </p>
            </div>
            <DeletePlannedExpenseButton id={e.id} />
          </CardHeader>
          <CardContent>
            <PlannedExpenseForm categories={expenseCategories} thisMonth={thisMonth} value={e} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
