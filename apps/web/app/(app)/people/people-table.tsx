'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';

export type PeopleRow = {
  id: string;
  fullName: string;
  position: string | null;
  seniority: string[];
  stack: string[];
  marketRateUsd: string | null;
  allocation: string | null;
  availabilityFrom: string | null;
  location: string | null;
  bench: 'free' | 'partial' | 'busy';
};

const benchVariant = { free: 'default', partial: 'secondary', busy: 'outline' } as const;

const col = appColumnHelper<PeopleRow>();

export function PeopleTable({ rows }: { rows: PeopleRow[] }) {
  const t = useTranslations('people');
  const fmt = useFormat();
  const { ALLOCATION_LABELS, BENCH_LABELS } = useLabels();
  const columns: AppColumnDef<PeopleRow>[] = [
    col.accessor('fullName', { header: t('col.name') }),
    col.accessor('position', { header: t('col.position') }),
    col.accessor((r) => r.seniority.join(', '), { id: 'seniority', header: t('col.seniority') }),
    col.accessor((r) => r.stack.join(', '), {
      id: 'stack',
      header: t('col.stack'),
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex max-w-80 flex-wrap gap-1">
          {row.original.stack.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ),
    }),
    col.accessor('marketRateUsd', {
      header: t('col.rate'),
      sortFn: 'decimal',
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return v ? fmt.amount(v) : '—';
      },
    }),
    col.accessor('bench', {
      header: t('col.bench'),
      cell: ({ row }) => (
        <Badge variant={benchVariant[row.original.bench]}>{BENCH_LABELS[row.original.bench]}</Badge>
      ),
    }),
    col.accessor('allocation', {
      header: t('col.allocation'),
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return v ? ALLOCATION_LABELS[v] : '—';
      },
    }),
    col.accessor('availabilityFrom', {
      header: t('col.availableFrom'),
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return v ? fmt.date(v) : t('col.now');
      },
    }),
    col.accessor('location', { header: t('col.location') }),
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder={t('search')}
      emptyText={t('empty')}
      rowHref={(r) => `/people/${r.id}`}
    />
  );
}
