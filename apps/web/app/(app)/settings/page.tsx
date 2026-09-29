import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OWNER_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { formatUaDate, isoDayOfWeek, type LocalDate } from '@tally/domain';
import { getCompany } from '@/server/services/company';
import { listCalendarExceptions, listSequences } from '@/server/services/settings';
import { CompanyForm } from './company-form';
import { CalendarExceptionForm, DeleteExceptionButton, SequenceForm } from './settings-forms';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

export const metadata: Metadata = { title: 'Налаштування · Tally' };

export default async function SettingsPage() {
  const ctx = await requireRole(OWNER_ROLES);
  const result = await getCompany.run(ctx, {});
  const company = result.isOk() ? result.value : null;
  const exceptions = (await listCalendarExceptions.run(ctx, {})).unwrapOr([]);
  const sequences = (await listSequences.run(ctx, {})).unwrapOr([]);
  const thisYear = ctx.today.slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Налаштування</h1>
      <Card>
        <CardHeader>
          <CardTitle>Реквізити компанії</CardTitle>
          <CardDescription>
            Використовуються в шапках інвойсів і актів та в договорах
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm
            company={
              company && {
                nameEn: company.nameEn,
                nameUa: company.nameUa,
                legalCode: company.legalCode,
                addressEn: company.addressEn,
                addressUa: company.addressUa,
                directorEn: company.directorEn,
                directorUa: company.directorUa,
                bankDetailsEn: company.bankDetailsEn,
                bankDetailsUa: company.bankDetailsUa,
              }
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Робочий календар</CardTitle>
          <CardDescription>
            Пн–Пт робочі за замовчуванням. Тут — святкові вихідні та робочі суботи; від цього
            залежать норма годин, дати документів і заборона випуску у неробочий день
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CalendarExceptionForm />
          {exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Винятків ще немає</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {exceptions.map((e) => (
                <li
                  key={e.onDate}
                  className={`flex items-center gap-3 ${e.onDate.startsWith(thisYear) ? '' : 'text-muted-foreground'}`}
                >
                  <span className="w-32 tabular-nums">
                    {formatUaDate(e.onDate as LocalDate)},{' '}
                    {WEEKDAYS[isoDayOfWeek(e.onDate as LocalDate) - 1]}
                  </span>
                  <span className="w-24">{e.isWorking ? 'робочий' : 'вихідний'}</span>
                  <span className="flex-1">{e.reason}</span>
                  <DeleteExceptionButton onDate={e.onDate} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Нумерація документів</CardTitle>
          <CardDescription>
            Номер присвоюється лише при випуску. Лічильник можна тільки збільшити. Токени шаблону:{' '}
            {'{seq}'} — номер, {'{yy}'}/{'{yyyy}'} — рік документа, {'{contract}'} — номер договору
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {sequences.map((s) => (
            <div key={s.key} className="flex flex-col gap-2 border-b pb-4">
              <div className="text-sm">
                <span className="font-medium">{s.key}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · наступний: <span className="text-foreground">{s.nextNumber}</span>
                  {s.contracts.length > 0 && ` · договори: ${s.contracts.join(', ')}`}
                  {s.key === 'invoice' && ' · за замовчуванням для інвойсів'}
                </span>
              </div>
              <SequenceForm
                sequence={{
                  key: s.key,
                  template: s.template,
                  nextValue: s.nextValue,
                  yearScoped: s.yearScoped,
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">Нова нумерація</div>
            <SequenceForm />
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Шаблони документів, користувачі й фонові задачі з’являться на наступних етапах.
      </p>
    </div>
  );
}
