'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';

export type InvoiceRow = {
  id: string;
  number: string | null;
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  total: string;
  remaining: string;
  overdueDays: number;
  revision: number;
  isLegacy: boolean;
  clientName: string;
};

const col = appColumnHelper<InvoiceRow>();

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const t = useTranslations('invoices');
  const fmt = useFormat();
  const { INVOICE_STATUS_LABELS } = useLabels();
  const columns: AppColumnDef<InvoiceRow>[] = [
    col.accessor((r) => r.number ?? t('draft'), { id: 'number', header: t('col.number') }),
    col.accessor('clientName', { header: t('col.client') }),
    col.accessor('issueDate', {
      header: t('col.date'),
      cell: ({ getValue }) => fmt.date(getValue<string>()),
    }),
    col.accessor('dueDate', {
      header: t('col.due'),
      cell: ({ row }) => (
        <span className={row.original.overdueDays > 0 ? 'text-destructive' : undefined}>
          {fmt.date(row.original.dueDate)}
          {row.original.overdueDays > 0 && t('overdue', { days: row.original.overdueDays })}
        </span>
      ),
    }),
    col.accessor('total', {
      header: t('col.total'),
      sortFn: 'decimal',
      cell: ({ row }) => fmt.amount(row.original.total, row.original.currency),
    }),
    col.accessor('remaining', {
      header: t('col.remaining'),
      sortFn: 'decimal',
      cell: ({ row }) =>
        row.original.status === 'draft' || row.original.status === 'void'
          ? '—'
          : fmt.amount(row.original.remaining, row.original.currency),
    }),
    col.accessor((r) => INVOICE_STATUS_LABELS[r.status] ?? r.status, {
      id: 'status',
      header: t('col.status'),
      cell: ({ row, getValue }) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={row.original.status === 'draft' ? 'outline' : 'secondary'}>
            {getValue<string>()}
          </Badge>
          {row.original.revision > 1 && (
            <Badge variant="outline">{t('revision', { revision: row.original.revision })}</Badge>
          )}
          {row.original.isLegacy && <Badge variant="outline">{t('legacy')}</Badge>}
        </span>
      ),
    }),
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder={t('search')}
      emptyText={t('empty')}
      rowHref={(r) => `/invoices/${r.id}`}
    />
  );
}
