import type { Metadata } from 'next';
import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ALLOCATION_LABELS, BENCH_LABELS, PERSON_STATUS_LABELS, toOptions } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchPeople } from '@/server/services/people';
import { PeopleTable, type PeopleRow } from './people-table';

export const metadata: Metadata = { title: 'Люди · Tally' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(ALL_ROLES);
  const params = await searchParams;
  const filters = Object.fromEntries(
    [
      'q',
      'stack',
      'seniority',
      'maxRate',
      'availableOn',
      'allocation',
      'location',
      'bench',
      'status',
    ].map((k) => [k, first(params[k])]),
  );
  const result = await searchPeople.run(ctx, filters);
  const rows: PeopleRow[] = result.isOk()
    ? result.value.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        position: p.position,
        seniority: p.seniority,
        stack: p.stack,
        marketRateUsd: p.marketRateUsd,
        allocation: p.allocation,
        availabilityFrom: p.availabilityFrom,
        location: p.location,
        bench: p.bench,
      }))
    : [];
  const canWrite = FINANCE_ROLES.includes(ctx.actor.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Люди</h1>
          <p className="text-muted-foreground">Пул спеціалістів (Bench)</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            render={<a href={`/api/people/export?${new URLSearchParams(filters).toString()}`} />}
          >
            Експорт CSV
          </Button>
          {canWrite && (
            <Button variant="outline" render={<Link href="/people/payees" />}>
              Одержувачі
            </Button>
          )}
          {canWrite && <Button render={<Link href="/people/new" />}>Додати людину</Button>}
        </div>
      </div>

      <form
        method="get"
        className="grid grid-cols-2 gap-3 rounded-md border p-4 md:grid-cols-4 lg:grid-cols-5"
        aria-label="Фільтри"
      >
        <FormField label="Стек" htmlFor="f-stack" hint="Через кому: Solidity, React">
          <Input id="f-stack" name="stack" defaultValue={filters.stack} />
        </FormField>
        <FormField label="Сеньйорність" htmlFor="f-seniority">
          <Input
            id="f-seniority"
            name="seniority"
            defaultValue={filters.seniority}
            placeholder="Senior"
          />
        </FormField>
        <FormField label="Ставка до, $/год" htmlFor="f-maxRate">
          <Input id="f-maxRate" name="maxRate" inputMode="decimal" defaultValue={filters.maxRate} />
        </FormField>
        <FormField label="Доступний на дату" htmlFor="f-availableOn">
          <Input
            id="f-availableOn"
            name="availableOn"
            type="date"
            defaultValue={filters.availableOn}
          />
        </FormField>
        <FormField label="Формат" htmlFor="f-allocation">
          <NativeSelect
            id="f-allocation"
            name="allocation"
            defaultValue={filters.allocation}
            placeholder="Будь-який"
            options={toOptions(ALLOCATION_LABELS)}
          />
        </FormField>
        <FormField label="Локація" htmlFor="f-location">
          <Input id="f-location" name="location" defaultValue={filters.location} />
        </FormField>
        <FormField label="Зайнятість" htmlFor="f-bench">
          <NativeSelect
            id="f-bench"
            name="bench"
            defaultValue={filters.bench}
            placeholder="Будь-яка"
            options={toOptions(BENCH_LABELS)}
          />
        </FormField>
        <FormField label="Статус" htmlFor="f-status">
          <NativeSelect
            id="f-status"
            name="status"
            defaultValue={filters.status}
            placeholder="Будь-який"
            options={toOptions(PERSON_STATUS_LABELS)}
          />
        </FormField>
        <div className="col-span-2 flex items-end gap-2">
          <Button type="submit">Застосувати</Button>
          <Button variant="ghost" render={<Link href={`/people?availableOn=${ctx.today}`} />}>
            Доступні зараз
          </Button>
          <Button variant="ghost" render={<Link href="/people" />}>
            Скинути
          </Button>
        </div>
      </form>

      {result.isErr() ? (
        <p className="text-destructive">{result.error.message}</p>
      ) : (
        <PeopleTable rows={rows} />
      )}
    </div>
  );
}
