'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';
import { Status } from '@/components/v2/status';
import { useIsV2 } from '@/components/v2/ui-version';

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

export function DocumentsTable({
  rows,
  toolbar,
}: {
  rows: DocumentRow[];
  /** v2: the server filters, which replace the quick search. */
  toolbar?: React.ReactNode;
}) {
  const t = useTranslations('documents');
  const fmt = useFormat();
  const { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS } = useLabels();
  const v2 = useIsV2();
  const columns: AppColumnDef<DocumentRow>[] = [
    col.accessor('title', {
      header: t('col.title'),
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
    col.accessor((r) => DOCUMENT_TYPE_LABELS[r.type], {
      id: 'type',
      header: t('col.type'),
    }),
    col.accessor('number', {
      header: t('col.number'),
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    }),
    col.accessor('docDate', {
      header: t('col.date'),
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return v ? fmt.date(v) : '—';
      },
    }),
    col.accessor((r) => DOC_STATUS_LABELS[r.status] ?? r.status, {
      id: 'status',
      header: t('col.status'),
      cell: ({ row }) => (
        <span className="flex gap-1">
          {v2 ? (
            <Status tone={row.original.status === 'issued' ? 'success' : 'neutral'}>
              {DOC_STATUS_LABELS[row.original.status]}
            </Status>
          ) : (
            DOC_STATUS_LABELS[row.original.status]
          )}
          {row.original.version > 1 && <Badge variant="secondary">v{row.original.version}</Badge>}
        </span>
      ),
    }),
    col.accessor((r) => r.links.map((l) => l.label).join(', '), {
      id: 'links',
      header: t('col.links'),
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
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder={t('quickSearch')}
      emptyText={t('empty')}
      rowHref={(r) => `/documents/${r.id}`}
      toolbar={toolbar}
      searchable={!toolbar}
    />
  );
}
