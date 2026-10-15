'use client';

import {
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  columnFilteringFeature,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortFn,
  type TableFeatures,
} from '@tanstack/react-table';
import { toDecimal } from '@tally/domain';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from 'cn';
import { useIsV2 } from '@/components/v2/ui-version';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Sorts decimal strings numerically without converting to floats. */
const sortFn_decimal: SortFn<TableFeatures, RowData> = (a, b, columnId) => {
  const x = a.getValue<string | null>(columnId);
  const y = b.getValue<string | null>(columnId);
  if (x === y) return 0;
  if (x === null || x === '') return -1;
  if (y === null || y === '') return 1;
  return toDecimal(x).comparedTo(toDecimal(y));
};

export const tableFeatureSet = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    text: sortFn_text,
    decimal: sortFn_decimal,
  },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

export type TableFeatureSet = typeof tableFeatureSet;
// Column value types differ per column; `any` here is what TanStack's own helpers use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppColumnDef<T extends RowData> = ColumnDef<TableFeatureSet, T, any>;

export function appColumnHelper<T extends RowData>() {
  return createColumnHelper<TableFeatureSet, T>();
}

type Props<T extends RowData> = {
  columns: AppColumnDef<T>[];
  data: T[];
  searchPlaceholder?: string;
  emptyText?: string;
  /** Row click navigates here (kept as a link for keyboard users in the first cell). */
  rowHref?: (row: T) => string;
  /** v2: filters shown on the search row. */
  toolbar?: React.ReactNode;
};

export function DataTable<T extends RowData>({
  columns,
  data,
  searchPlaceholder,
  emptyText,
  rowHref,
  toolbar,
}: Props<T>) {
  const t = useTranslations('common');
  const router = useRouter();
  const v2 = useIsV2();
  const [search, setSearch] = useState('');
  const table = useTable({
    features: tableFeatureSet,
    columns,
    data,
    globalFilterFn: 'includesString',
  });

  return (
    <div className="flex flex-col gap-3">
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                table.setGlobalFilter(e.target.value);
              }}
              placeholder={searchPlaceholder ?? t('search')}
              aria-label={searchPlaceholder ?? t('search')}
              className="pl-8"
            />
          </div>
          {toolbar}
        </div>
      ) : (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              table.setGlobalFilter(e.target.value);
            }}
            placeholder={searchPlaceholder ?? t('search')}
            aria-label={searchPlaceholder ?? t('search')}
            className="pl-8"
          />
        </div>
      )}
      <div
        className={
          v2 ? 'overflow-x-auto rounded-lg border bg-card' : 'overflow-x-auto rounded-md border'
        }
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1 hover:text-foreground',
                            v2 && 'group/sort',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <ArrowUpDown
                              className={cn(
                                'size-3.5 opacity-40',
                                v2 && 'opacity-0 group-hover/sort:opacity-40',
                              )}
                            />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-20 text-center text-muted-foreground"
                >
                  {emptyText ?? t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={rowHref ? 'cursor-pointer' : undefined}
                  onClick={
                    rowHref
                      ? () => {
                          router.push(rowHref(row.original));
                        }
                      : undefined
                  }
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('shown', { shown: table.getRowModel().rows.length, total: data.length })}
      </p>
    </div>
  );
}
