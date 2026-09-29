'use client';

import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { INVOICE_STATUS_LABELS } from '@/lib/labels';

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
const columns: AppColumnDef<InvoiceRow>[] = [
  col.accessor((r) => r.number ?? 'Чернетка', { id: 'number', header: 'Номер' }),
  col.accessor('clientName', { header: 'Клієнт' }),
  col.accessor('issueDate', {
    header: 'Дата',
    cell: ({ getValue }) => formatUaDate(getValue<LocalDate>()),
  }),
  col.accessor('dueDate', {
    header: 'Оплатити до',
    cell: ({ row }) => (
      <span className={row.original.overdueDays > 0 ? 'text-destructive' : undefined}>
        {formatUaDate(row.original.dueDate as LocalDate)}
        {row.original.overdueDays > 0 && ` (+${String(row.original.overdueDays)} дн.)`}
      </span>
    ),
  }),
  col.accessor('total', {
    header: 'Сума',
    sortFn: 'decimal',
    cell: ({ row }) => formatAmount(row.original.total, row.original.currency),
  }),
  col.accessor('remaining', {
    header: 'Залишок',
    sortFn: 'decimal',
    cell: ({ row }) =>
      row.original.status === 'draft' || row.original.status === 'void'
        ? '—'
        : formatAmount(row.original.remaining, row.original.currency),
  }),
  col.accessor((r) => INVOICE_STATUS_LABELS[r.status] ?? r.status, {
    id: 'status',
    header: 'Статус',
    cell: ({ row, getValue }) => (
      <span className="flex flex-wrap gap-1">
        <Badge variant={row.original.status === 'draft' ? 'outline' : 'secondary'}>
          {getValue<string>()}
        </Badge>
        {row.original.revision > 1 && <Badge variant="outline">ред. {row.original.revision}</Badge>}
        {row.original.isLegacy && <Badge variant="outline">архів</Badge>}
      </span>
    ),
  }),
];

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Пошук за номером чи клієнтом…"
      emptyText="Інвойсів ще немає"
      rowHref={(r) => `/invoices/${r.id}`}
    />
  );
}
