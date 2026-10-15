import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toOptions } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchDocuments } from '@/server/services/documents/registry';
import { DocumentsNav } from './documents-nav';
import { DocumentsTreeView } from './documents-tree';
import { DocumentsTable } from './documents-table';
import { getTranslations } from 'next-intl/server';
import { getLabels, getLocalizeText, localizeForUser, pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { AutoFilters } from '@/components/v2/auto-filters';

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
  const canWrite = FINANCE_ROLES.includes(ctx.actor.role);
  // The tree is the default view; any search or filter switches to the flat list (A-081).
  const list = params.view === 'list' || Object.values(filters).some(Boolean);
  if (!list) return <DocumentsTreeView ctx={ctx} canWrite={canWrite} />;
  const result = await searchDocuments.run(ctx, filters);
  const t = await getTranslations('documents');
  const { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS } = await getLabels();
  const localize = await getLocalizeText();

  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        {v2 ? (
          <PageHeader title={t('title')} help={t('subtitle')} />
        ) : (
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground">{t('subtitle')}</p>
          </div>
        )}
        {canWrite && <Button render={<Link href="/documents/new" />}>{t('add')}</Button>}
      </div>
      <DocumentsNav current="list" finance={canWrite} />

      {v2 ? (
        <AutoFilters
          label={t('filters')}
          clearLabel={(await getTranslations('common'))('clearFilters')}
          fields={[
            { kind: 'text', name: 'q', label: t('q') },
            {
              kind: 'select',
              name: 'type',
              label: t('type'),
              allLabel: t('all'),
              options: Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            },
            {
              kind: 'select',
              name: 'status',
              label: t('status'),
              allLabel: t('all'),
              options: Object.entries(DOC_STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            },
            { kind: 'toggle', name: 'unlinked', label: t('unlinked') },
          ]}
        />
      ) : (
        <form
          method="get"
          className="grid grid-cols-2 gap-3 rounded-md border p-4 md:grid-cols-5"
          aria-label={t('filters')}
        >
          <input type="hidden" name="view" value="list" />
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
            <Button variant="ghost" render={<Link href="/documents?view=list" />}>
              {t('reset')}
            </Button>
          </div>
        </form>
      )}

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
