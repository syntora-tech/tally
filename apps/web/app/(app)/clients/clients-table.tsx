'use client';

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
const columns: AppColumnDef<ClientRow>[] = [
  col.accessor((r) => r.shortName ?? r.legalName, { id: 'name', header: 'Клієнт' }),
  col.accessor('legalName', { header: 'Юридична назва' }),
  col.accessor('country', {
    header: 'Країна',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  }),
  col.accessor('defaultCurrency', { header: 'Валюта' }),
  col.accessor('contracts', { header: 'Договорів', sortFn: 'basic' }),
];

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Пошук клієнта…"
      emptyText="Клієнтів ще немає"
      rowHref={(r) => `/clients/${r.id}`}
    />
  );
}
