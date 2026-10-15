'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { appColumnHelper, DataTable, type AppColumnDef } from '@/components/data-table';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';
import { Status, type Tone } from '@/components/v2/status';
import { useIsV2 } from '@/components/v2/ui-version';

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

const BENCH_TONES: Record<PeopleRow['bench'], Tone> = {
  free: 'success',
  partial: 'info',
  busy: 'neutral',
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

const STACK_SHOWN = 3;

export function PeopleTable({ rows, toolbar }: { rows: PeopleRow[]; toolbar?: React.ReactNode }) {
  const t = useTranslations('people');
  const fmt = useFormat();
  const { ALLOCATION_LABELS, BENCH_LABELS } = useLabels();
  const v2 = useIsV2();
  const v2Columns: AppColumnDef<PeopleRow>[] = [
    col.accessor((r) => `${r.fullName} ${r.position ?? ''} ${r.seniority.join(' ')}`, {
      id: 'fullName',
      header: t('col.person'),
      sortFn: 'text',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-success-foreground"
          >
            {initials(row.original.fullName)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{row.original.fullName}</span>
            {(row.original.position ?? row.original.seniority.length > 0) && (
              <span className="text-xs text-muted-foreground">
                {[row.original.position, row.original.seniority.join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </span>
        </span>
      ),
    }),
    col.accessor((r) => r.stack.join(', '), {
      id: 'stack',
      header: t('col.stack'),
      enableSorting: false,
      cell: ({ row }) => {
        const { stack } = row.original;
        const rest = stack.slice(STACK_SHOWN);
        return (
          <span className="flex flex-nowrap gap-1">
            {stack.slice(0, STACK_SHOWN).map((tag) => (
              <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs whitespace-nowrap">
                {tag}
              </span>
            ))}
            {rest.length > 0 && (
              <span
                title={rest.join(', ')}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                +{rest.length}
              </span>
            )}
          </span>
        );
      },
    }),
    col.accessor('bench', {
      header: t('col.bench'),
      cell: ({ row }) => (
        <Status tone={BENCH_TONES[row.original.bench]}>{BENCH_LABELS[row.original.bench]}</Status>
      ),
    }),
    col.accessor('availabilityFrom', {
      header: t('col.availableFrom'),
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return v ? fmt.date(v) : t('col.now');
      },
    }),
    col.accessor('location', {
      header: t('col.location'),
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    }),
    col.accessor('marketRateUsd', {
      header: t('col.rate'),
      sortFn: 'decimal',
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return v ? <span className="tabular-nums">{fmt.amount(v)}</span> : '—';
      },
    }),
  ];
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
      columns={v2 ? v2Columns : columns}
      data={rows}
      searchPlaceholder={t('search')}
      emptyText={t('empty')}
      rowHref={(r) => `/people/${r.id}`}
      toolbar={toolbar}
    />
  );
}
