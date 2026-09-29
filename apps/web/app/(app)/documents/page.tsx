import type { Metadata } from 'next';
import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS, toOptions } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchDocuments } from '@/server/services/documents/registry';
import { DocumentsTable } from './documents-table';

export const metadata: Metadata = { title: 'Документи · Tally' };

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Документи</h1>
          <p className="text-muted-foreground">Договори, SOW, акти, CV, NDA та інші документи</p>
        </div>
        {canWrite && <Button render={<Link href="/documents/new" />}>Додати документ</Button>}
      </div>

      <form
        method="get"
        className="grid grid-cols-2 gap-3 rounded-md border p-4 md:grid-cols-5"
        aria-label="Фільтри"
      >
        <FormField
          label="Номер або назва"
          htmlFor="f-q"
          className="col-span-2"
          hint="1003-A4 знайде «1003 - А4»"
        >
          <Input id="f-q" name="q" defaultValue={filters.q} />
        </FormField>
        <FormField label="Тип" htmlFor="f-type">
          <NativeSelect
            id="f-type"
            name="type"
            defaultValue={filters.type}
            placeholder="Усі"
            options={toOptions(DOCUMENT_TYPE_LABELS)}
          />
        </FormField>
        <FormField label="Статус" htmlFor="f-status">
          <NativeSelect
            id="f-status"
            name="status"
            defaultValue={filters.status}
            placeholder="Усі"
            options={toOptions(DOC_STATUS_LABELS)}
          />
        </FormField>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="unlinked" defaultChecked={filters.unlinked === 'on'} /> Без
          прив’язок
        </label>
        <div className="col-span-2 flex gap-2 md:col-span-5">
          <Button type="submit">Шукати</Button>
          <Button variant="ghost" render={<Link href="/documents" />}>
            Скинути
          </Button>
        </div>
      </form>

      {result.isErr() ? (
        <p className="text-destructive">{result.error.message}</p>
      ) : (
        <DocumentsTable rows={result.value} />
      )}
    </div>
  );
}
