import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toOptions } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchDocuments } from '@/server/services/documents/registry';
import { DocumentsNav } from './documents-nav';
import { DocumentsTable } from './documents-table';
import { getTranslations } from 'next-intl/server';
import { getLabels, getLocalizeText, localizeForUser, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('documents');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(ALL_ROLES);
  const params = await searchParams;
  const filters = {
    q: first(params.q),
    type: first(params.type),
    status: first(params.status),
    unlinked: first(params.unlinked),
  };
  const result = await searchDocuments.run(ctx, filters);
  const canWrite = FINANCE_ROLES.includes(ctx.actor.role);
  const t = await getTranslations('documents');
  const { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS } = await getLabels();
  const localize = await getLocalizeText();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canWrite && <Button render={<Link href="/documents/new" />}>{t('add')}</Button>}
      </div>
      {canWrite && <DocumentsNav current="registry" />}

      <form
        method="get"
        className="grid grid-cols-2 gap-3 rounded-md border p-4 md:grid-cols-5"
        aria-label={t('filters')}
      >
        <FormField label={t('q')} htmlFor="f-q" className="col-span-2" hint={t('qHint')}>
          <Input id="f-q" name="q" defaultValue={filters.q} />
        </FormField>
        <FormField label={t('type')} htmlFor="f-type">
          <NativeSelect
            id="f-type"
            name="type"
            defaultValue={filters.type}
            placeholder={t('all')}
            options={toOptions(DOCUMENT_TYPE_LABELS)}
          />
        </FormField>
        <FormField label={t('status')} htmlFor="f-status">
          <NativeSelect
            id="f-status"
            name="status"
            defaultValue={filters.status}
            placeholder={t('all')}
            options={toOptions(DOC_STATUS_LABELS)}
          />
        </FormField>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="unlinked" defaultChecked={filters.unlinked === 'on'} />{' '}
          {t('unlinked')}
        </label>
        <div className="col-span-2 flex gap-2 md:col-span-5">
          <Button type="submit">{t('search')}</Button>
          <Button variant="ghost" render={<Link href="/documents" />}>
            {t('reset')}
          </Button>
        </div>
      </form>

      {result.isErr() ? (
        <p className="text-destructive">{(await localizeForUser(result.error)).message}</p>
      ) : (
        <DocumentsTable
          rows={result.value.map((d) => ({
            ...d,
            links: d.links.map((l) => ({ ...l, label: localize(l.label) })),
          }))}
        />
      )}
    </div>
  );
}
