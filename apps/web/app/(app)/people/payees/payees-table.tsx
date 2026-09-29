'use client';

import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { PAYEE_KIND_LABELS } from '@/lib/labels';

export type PayeeRow = {
  id: string;
  kind: string;
  name: string;
  taxId: string | null;
  iban: string | null;
  walletNetwork: string | null;
  personName: string | null;
};

const col = appColumnHelper<PayeeRow>();
const columns: AppColumnDef<PayeeRow>[] = [
  col.accessor('name', { header: 'Назва' }),
  col.accessor((r) => PAYEE_KIND_LABELS[r.kind] ?? r.kind, { id: 'kind', header: 'Тип' }),
  col.accessor('personName', {
    header: 'Людина',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  }),
  col.accessor('taxId', {
    header: 'ІПН',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  }),
  col.accessor((r) => r.iban ?? r.walletNetwork ?? '', {
    id: 'account',
    header: 'Рахунок / мережа',
    cell: ({ getValue }) => getValue<string>() || '—',
  }),
];

export function PayeesTable({ rows }: { rows: PayeeRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Пошук за назвою, ІПН…"
      emptyText="Одержувачів ще немає"
      rowHref={(r) => `/people/payees/${r.id}`}
    />
  );
}
