'use client';

import { useTranslations } from 'next-intl';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { useLabels } from '@/lib/labels';

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

export function PayeesTable({ rows }: { rows: PayeeRow[] }) {
  const t = useTranslations('payees');
  const { PAYEE_KIND_LABELS } = useLabels();
  const columns: AppColumnDef<PayeeRow>[] = [
    col.accessor('name', { header: t('col.name') }),
    col.accessor((r) => PAYEE_KIND_LABELS[r.kind] ?? r.kind, { id: 'kind', header: t('col.kind') }),
    col.accessor('personName', {
      header: t('col.person'),
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    }),
    col.accessor('taxId', {
      header: t('col.taxId'),
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    }),
    col.accessor((r) => r.iban ?? r.walletNetwork ?? '', {
      id: 'account',
      header: t('col.account'),
      cell: ({ getValue }) => getValue<string>() || '—',
    }),
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder={t('search')}
      emptyText={t('empty')}
      rowHref={(r) => `/people/payees/${r.id}`}
    />
  );
}
