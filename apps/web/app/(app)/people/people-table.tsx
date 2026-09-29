'use client';

import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { ALLOCATION_LABELS, BENCH_LABELS } from '@/lib/labels';

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
const columns: AppColumnDef<PeopleRow>[] = [
  col.accessor('fullName', { header: 'Ім’я' }),
  col.accessor('position', { header: 'Позиція' }),
  col.accessor((r) => r.seniority.join(', '), { id: 'seniority', header: 'Сеньйорність' }),
  col.accessor((r) => r.stack.join(', '), {
    id: 'stack',
    header: 'Стек',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex max-w-80 flex-wrap gap-1">
        {row.original.stack.map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
      </div>
    ),
  }),
  col.accessor('marketRateUsd', {
    header: 'Ставка, $/год',
    sortFn: 'decimal',
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? formatAmount(v) : '—';
    },
  }),
  col.accessor('bench', {
    header: 'Зайнятість',
    cell: ({ row }) => (
      <Badge variant={benchVariant[row.original.bench]}>{BENCH_LABELS[row.original.bench]}</Badge>
    ),
  }),
  col.accessor('allocation', {
    header: 'Формат',
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? ALLOCATION_LABELS[v] : '—';
    },
  }),
  col.accessor('availabilityFrom', {
    header: 'Доступний з',
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? formatUaDate(v as LocalDate) : 'зараз';
    },
  }),
  col.accessor('location', { header: 'Локація' }),
];

export function PeopleTable({ rows }: { rows: PeopleRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Пошук за ім’ям, стеком…"
      emptyText="Нікого не знайдено"
      rowHref={(r) => `/people/${r.id}`}
    />
  );
}
