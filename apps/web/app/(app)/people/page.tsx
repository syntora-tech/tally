import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toOptions } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchPeople } from '@/server/services/people';
import { PeopleTable, type PeopleRow } from './people-table';
import { getTranslations } from 'next-intl/server';
import { getLabels, localizeForUser, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('people');

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
  const t = await getTranslations('people');
  const { ALLOCATION_LABELS, BENCH_LABELS, PERSON_STATUS_LABELS } = await getLabels();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            render={<a href={`/api/people/export?${new URLSearchParams(filters).toString()}`} />}
          >
            {t('exportCsv')}
          </Button>
          {canWrite && (
            <Button variant="outline" render={<Link href="/people/payees" />}>
              {t('payees')}
            </Button>
          )}
          {canWrite && <Button render={<Link href="/people/new" />}>{t('add')}</Button>}
        </div>
      </div>

      <form
        method="get"
        className="grid grid-cols-2 gap-3 rounded-md border p-4 md:grid-cols-4 lg:grid-cols-5"
        aria-label={t('filters')}
      >
        <FormField label={t('stack')} htmlFor="f-stack" hint={t('stackHint')}>
          <Input id="f-stack" name="stack" defaultValue={filters.stack} />
        </FormField>
        <FormField label={t('seniority')} htmlFor="f-seniority">
          <Input
            id="f-seniority"
            name="seniority"
            defaultValue={filters.seniority}
            placeholder="Senior"
          />
        </FormField>
        <FormField label={t('maxRate')} htmlFor="f-maxRate">
          <Input id="f-maxRate" name="maxRate" inputMode="decimal" defaultValue={filters.maxRate} />
        </FormField>
        <FormField label={t('availableOn')} htmlFor="f-availableOn">
          <Input
            id="f-availableOn"
            name="availableOn"
            type="date"
            defaultValue={filters.availableOn}
          />
        </FormField>
        <FormField label={t('allocation')} htmlFor="f-allocation">
          <NativeSelect
            id="f-allocation"
            name="allocation"
            defaultValue={filters.allocation}
            placeholder={t('anyMasc')}
            options={toOptions(ALLOCATION_LABELS)}
          />
        </FormField>
        <FormField label={t('location')} htmlFor="f-location">
          <Input id="f-location" name="location" defaultValue={filters.location} />
        </FormField>
        <FormField label={t('bench')} htmlFor="f-bench">
          <NativeSelect
            id="f-bench"
            name="bench"
            defaultValue={filters.bench}
            placeholder={t('anyFem')}
            options={toOptions(BENCH_LABELS)}
          />
        </FormField>
        <FormField label={t('status')} htmlFor="f-status">
          <NativeSelect
            id="f-status"
            name="status"
            defaultValue={filters.status}
            placeholder={t('anyMasc')}
            options={toOptions(PERSON_STATUS_LABELS)}
          />
        </FormField>
        <div className="col-span-2 flex items-end gap-2">
          <Button type="submit">{t('apply')}</Button>
          <Button variant="ghost" render={<Link href={`/people?availableOn=${ctx.today}`} />}>
            {t('availableNow')}
          </Button>
          <Button variant="ghost" render={<Link href="/people" />}>
            {t('reset')}
          </Button>
        </div>
      </form>

      {result.isErr() ? (
        <p className="text-destructive">{(await localizeForUser(result.error)).message}</p>
      ) : (
        <PeopleTable rows={rows} />
      )}
    </div>
  );
}
