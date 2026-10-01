'use client';

import { useTranslations } from 'next-intl';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';

export type ClientRow = {
  id: string;
  legalName: string;
  shortName: string | null;
  country: string | null;
  defaultCurrency: string;
  contracts: number;
};

const col = appColumnHelper<ClientRow>();

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const t = useTranslations('clients');
  const columns: AppColumnDef<ClientRow>[] = [
    col.accessor((r) => r.shortName ?? r.legalName, { id: 'name', header: t('col.client') }),
    col.accessor('legalName', { header: t('col.legalName') }),
    col.accessor('country', {
      header: t('col.country'),
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    }),
    col.accessor('defaultCurrency', { header: t('col.currency') }),
    col.accessor('contracts', { header: t('col.contracts'), sortFn: 'basic' }),
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder={t('search')}
      emptyText={t('empty')}
      rowHref={(r) => `/clients/${r.id}`}
    />
  );
}
