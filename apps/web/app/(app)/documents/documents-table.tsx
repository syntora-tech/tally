'use client';

import { formatUaDate, type LocalDate } from '@tally/domain';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels';

export type DocumentRow = {
  id: string;
  type: string;
  number: string | null;
  title: string;
  docDate: string | null;
  status: string;
  version: number;
  links: { entityType: string; entityId: string; label: string; href: string | null }[];
};

const col = appColumnHelper<DocumentRow>();
const columns: AppColumnDef<DocumentRow>[] = [
  col.accessor('title', {
    header: 'Назва',
    cell: ({ row }) => (
      <Link
        href={`/documents/${row.original.id}`}
        className="font-medium hover:underline"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {row.original.title}
      </Link>
    ),
  }),
  col.accessor((r) => DOCUMENT_TYPE_LABELS[r.type as keyof typeof DOCUMENT_TYPE_LABELS], {
    id: 'type',
    header: 'Тип',
  }),
  col.accessor('number', {
    header: 'Номер',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  }),
  col.accessor('docDate', {
    header: 'Дата',
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? formatUaDate(v as LocalDate) : '—';
    },
  }),
  col.accessor((r) => DOC_STATUS_LABELS[r.status] ?? r.status, {
    id: 'status',
    header: 'Статус',
    cell: ({ row }) => (
      <span className="flex gap-1">
        {DOC_STATUS_LABELS[row.original.status]}
        {row.original.version > 1 && <Badge variant="secondary">v{row.original.version}</Badge>}
      </span>
    ),
  }),
  col.accessor((r) => r.links.map((l) => l.label).join(', '), {
    id: 'links',
    header: 'Прив’язки',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex max-w-96 flex-wrap gap-1">
        {row.original.links.map((l) => (
          <Badge key={`${l.entityType}:${l.entityId}`} variant="outline">
            {l.label}
          </Badge>
        ))}
      </div>
    ),
  }),
];

export function DocumentsTable({ rows }: { rows: DocumentRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Швидкий пошук у результатах…"
      emptyText="Документів не знайдено"
      rowHref={(r) => `/documents/${r.id}`}
    />
  );
}
