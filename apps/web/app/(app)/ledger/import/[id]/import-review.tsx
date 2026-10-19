'use client';

import {
  diffDays,
  explorerTxUrl,
  isCryptoNetwork,
  shortAddress,
  type LocalDate,
} from '@tally/domain';
import { cn } from 'cn';
import { ExternalLink, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';
import {
  commitImportAction,
  discardImportAction,
  suggestImportAction,
} from '@/server/actions/ledger-import';
import type { Decision, ImportRow } from '@/server/services/ledger/import';

type Option = { id: string; name: string };
type Props = {
  importId: string;
  editable: boolean;
  rows: ImportRow[];
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; txType: string; name: string }[];
  people: Option[];
  clients: Option[];
  aiEnabled: boolean;
};

const TYPES = [
  'revenue',
  'expense',
  'transfer',
  'fx_exchange',
  'crypto_buy',
  'crypto_sell',
  'crypto_swap',
] as const;
const TWO_LEG = new Set(['transfer', 'fx_exchange', 'crypto_buy', 'crypto_sell', 'crypto_swap']);
const bookable = (r: ImportRow) =>
  r.status === 'new' || r.status === 'match' || r.status === 'possible_duplicate';
const FILTERS = ['all', 'book', 'attention', 'skipped'] as const;

const selectClass =
  'h-8 w-full max-w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50';

export function ImportReview(props: Props) {
  const { importId, editable, rows, accounts, categories, people, clients, aiEnabled } = props;
  const t = useTranslations('ledgerImport');
  const fmt = useFormat();
  const { TX_TYPE_LABELS } = useLabels();
  const accountOf = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryName = (type: string, name: string) =>
    categories.find((c) => c.txType === type && c.name === name)?.id ?? null;

  const initial = useMemo(() => {
    const out: Record<string, Decision> = {};
    for (const r of rows) {
      out[r.key] = {
        key: r.key,
        include: (r.status === 'new' || r.status === 'match') && !r.flags.includes('dust'),
        type: r.suggestion?.type ?? (r.direction === 'in' ? 'revenue' : 'expense'),
        categoryId: r.suggestion?.categoryId ?? null,
        personId: r.suggestion?.personId ?? null,
        clientId: r.suggestion?.clientId ?? null,
        description: r.suggestion?.description ?? null,
        attachTo: r.attachTo,
      };
    }
    return out;
  }, [rows]);
  const [decisions, setDecisions] = useState(initial);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  // New suggestions (AI) arrive as new rows from the server; rows the person changed keep their edits.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setDecisions((current) => {
      const next = { ...initial };
      for (const key of touched) if (current[key]) next[key] = current[key];
      return next;
    });
  }

  const [commitState, commit, committing] = useActionState(commitImportAction, null);
  const [suggestState, suggest, suggesting] = useActionState(suggestImportAction, null);
  const [, discard, discarding] = useActionState(discardImportAction, null);
  useEffect(() => {
    if (suggestState?.ok)
      toast.success(t('aiDone', { count: (suggestState.data as { suggested: number }).suggested }));
    else if (suggestState) toast.error(suggestState.error.message);
  }, [suggestState, t]);
  useEffect(() => {
    if (commitState && !commitState.ok) toast.error(commitState.error.message);
  }, [commitState]);
  const rowErrors = commitState && !commitState.ok ? (commitState.error.fieldErrors ?? {}) : {};
  const committed = commitState?.ok
    ? (commitState.data as {
        created: number;
        linked: number;
        duplicates: number;
        accounts: { accountId: string; lastDate: string }[];
      })
    : null;
  const readOnly = !editable || Boolean(committed);

  const update = (key: string, patch: Partial<Decision>) => {
    setTouched((current) => {
      const next = new Set(current).add(key);
      const target = patch.attachTo ?? decisions[key]?.attachTo;
      return target ? next.add(target) : next;
    });
    setDecisions((current) => {
      const d = current[key];
      if (!d) return current;
      const next = { ...current, [key]: { ...d, ...patch } };
      // Attaching the other leg makes the main row an exchange or a transfer, detaching undoes it.
      if ('attachTo' in patch) {
        const row = rows.find((r) => r.key === key);
        for (const target of [d.attachTo, patch.attachTo]) {
          const main = rows.find((r) => r.key === target);
          const md = main && next[main.key];
          if (!row || !main || !md || row.direction === main.direction) continue;
          const legs = Object.values(next).some(
            (x) =>
              x.attachTo === main.key &&
              rows.find((r) => r.key === x.key)?.direction !== main.direction,
          );
          const plain = main.direction === 'in' ? 'revenue' : 'expense';
          const type = legs ? (main.currency === row.currency ? 'transfer' : 'fx_exchange') : plain;
          if (md.type !== type) {
            next[main.key] = {
              ...md,
              type,
              categoryId: legs
                ? categoryName(type, type === 'transfer' ? 'Internal Transfer' : 'FX Exchange')
                : null,
            };
          }
        }
      }
      return next;
    });
  };

  const isMain = (r: ImportRow) => !decisions[r.key]?.attachTo;
  const needsAttention = (r: ImportRow) =>
    bookable(r) &&
    decisions[r.key]?.include &&
    isMain(r) &&
    r.status !== 'match' &&
    !decisions[r.key]?.categoryId;
  const visible = rows.filter((r) => {
    if (filter === 'book') return decisions[r.key]?.include && bookable(r);
    if (filter === 'attention') return needsAttention(r) || Boolean(rowErrors[`rows.${r.key}`]);
    if (filter === 'skipped') return !bookable(r) || !decisions[r.key]?.include;
    return true;
  });
  const counts = {
    all: rows.length,
    book: rows.filter((r) => decisions[r.key]?.include && bookable(r) && isMain(r)).length,
    attention: rows.filter(needsAttention).length,
    skipped: rows.filter((r) => !bookable(r) || !decisions[r.key]?.include).length,
  };

  // Only a fee or the incoming leg of an exchange/transfer is ever part of another row.
  const mayAttach = (row: ImportRow) =>
    Boolean(decisions[row.key]?.attachTo) ||
    row.direction === 'in' ||
    /коміс|комiс|commission|\bfee\b/i.test(row.purpose ?? '');
  const candidatesFor = (row: ImportRow) =>
    rows.filter(
      (r) =>
        r.key !== row.key &&
        bookable(r) &&
        r.status !== 'match' &&
        !decisions[r.key]?.attachTo &&
        Math.abs(diffDays(r.occurredOn as LocalDate, row.occurredOn as LocalDate)) <= 3 &&
        (r.direction !== row.direction ? r.accountId !== row.accountId : row.direction === 'out'),
    );

  const partyValue = (d: Decision) =>
    d.personId ? `p:${d.personId}` : d.clientId ? `c:${d.clientId}` : '';
  const sourceLabel = (r: ImportRow) =>
    r.source.file ? `${r.source.file}:${String(r.source.line ?? '')}` : null;

  if (committed) {
    return (
      <div
        className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm"
        data-testid="import-committed"
      >
        <p className="font-medium">
          {t('committed', { created: committed.created, linked: committed.linked })}
        </p>
        <p className="text-muted-foreground">{t('reconcileHint')}</p>
        <ul className="flex flex-col gap-1">
          {committed.accounts.map((a) => (
            <li key={a.accountId}>
              <Link
                className="underline"
                href={`/ledger/reconcile?accountId=${a.accountId}&onDate=${a.lastDate}`}
              >
                {t('reconcileLink', {
                  account: accountOf.get(a.accountId)?.name ?? '',
                  date: fmt.date(a.lastDate),
                })}
              </Link>
            </li>
          ))}
        </ul>
        <Link className="underline" href="/ledger">
          {t('openJournal')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('filter')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => {
                setFilter(f);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                filter === f ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted',
              )}
            >
              {t(`filters.${f}`)} · {counts[f]}
            </button>
          ))}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {aiEnabled && (
              <form action={suggest}>
                <input type="hidden" name="importId" value={importId} />
                <input type="hidden" name="scope" value={counts.attention ? 'missing' : 'all'} />
                <Button type="submit" variant="outline" disabled={suggesting}>
                  <Sparkles className="size-4" aria-hidden />
                  {suggesting
                    ? t('aiRunning')
                    : counts.attention
                      ? t('aiMissing', { count: counts.attention })
                      : t('aiAll')}
                </Button>
              </form>
            )}
            <form action={discard}>
              <input type="hidden" name="id" value={importId} />
              <Button type="submit" variant="outline" disabled={discarding}>
                {t('discard')}
              </Button>
            </form>
            <form action={commit}>
              <input type="hidden" name="importId" value={importId} />
              <input
                type="hidden"
                name="decisions"
                value={JSON.stringify(Object.values(decisions))}
              />
              <Button
                type="submit"
                disabled={committing || counts.book === 0}
                data-testid="import-commit"
              >
                {committing ? t('booking') : t('book', { count: counts.book })}
              </Button>
            </form>
          </div>
        )}
      </div>
      {commitState && !commitState.ok && (
        <p className="text-sm text-destructive" role="alert">
          {commitState.error.message}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-2 py-2 text-left font-normal">{t('col.date')}</th>
              <th className="px-2 py-2 text-right font-normal">{t('col.amount')}</th>
              <th className="px-2 py-2 text-left font-normal">{t('col.what')}</th>
              <th className="px-2 py-2 text-left font-normal">{t('col.status')}</th>
              <th className="px-2 py-2 text-left font-normal">{t('col.booking')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = decisions[r.key];
              if (!d) return null;
              const acc = accountOf.get(r.accountId);
              const error = rowErrors[`rows.${r.key}`];
              const attached = Boolean(d.attachTo);
              const disabled = readOnly || !bookable(r);
              const explorer =
                r.network && r.ref && isCryptoNetwork(r.network)
                  ? explorerTxUrl(r.network, r.ref)
                  : null;
              return (
                <tr
                  key={r.key}
                  data-testid="import-row"
                  data-status={r.status}
                  className={cn(
                    'border-t align-top',
                    (!d.include || !bookable(r)) && 'text-muted-foreground',
                    attached && 'bg-muted/20',
                  )}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={t('include')}
                      checked={d.include && bookable(r)}
                      disabled={disabled}
                      onChange={(e) => {
                        update(r.key, { include: e.target.checked });
                      }}
                    />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                    {fmt.date(r.occurredOn)}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    <span
                      className={
                        r.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : ''
                      }
                    >
                      {r.direction === 'in' ? '+' : '−'}
                      {fmt.amount(r.amount, r.currency)}
                    </span>
                    <div className="text-xs text-muted-foreground">{acc?.name}</div>
                    {r.fee && (
                      <div className="text-xs text-muted-foreground">
                        {t('gas', {
                          amount: fmt.amount(
                            r.fee.amount,
                            accountOf.get(r.fee.accountId)?.currency,
                          ),
                        })}
                      </div>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-2 py-2">
                    <div className="font-medium">
                      {r.counterparty ??
                        (r.counterpartyAddress ? (
                          <span className="font-mono" title={r.counterpartyAddress}>
                            {shortAddress(r.counterpartyAddress)}
                          </span>
                        ) : (
                          '—'
                        ))}
                    </div>
                    {r.purpose && (
                      <div className="line-clamp-2 text-xs text-muted-foreground" title={r.purpose}>
                        {r.purpose}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {r.ref && (
                        <span className="font-mono" title={r.externalRef}>
                          {explorer ? (
                            <a
                              href={explorer}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 underline"
                            >
                              {shortAddress(r.ref)} <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : (
                            r.ref
                          )}
                        </span>
                      )}
                      {sourceLabel(r) && <span>{sourceLabel(r)}</span>}
                      {r.flags.map((f) => (
                        <Badge key={f} variant="outline">
                          {t(`flag.${f as 'dust' | 'no_gas_account'}`)}
                        </Badge>
                      ))}
                    </div>
                    {error && (
                      <ul className="mt-1 text-xs text-destructive" role="alert">
                        {error.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={r.status === 'new' ? 'default' : 'outline'}>
                      {t(`rowStatus.${r.status}`)}
                    </Badge>
                    {r.existingId && (
                      <Link
                        href={`/ledger/${r.existingId}`}
                        className="mt-1 block text-xs underline"
                        target="_blank"
                      >
                        {t('openExisting')}
                      </Link>
                    )}
                  </td>
                  <td className="w-[20rem] min-w-[20rem] px-2 py-2">
                    {bookable(r) && (
                      <div className="flex flex-col gap-1.5">
                        {mayAttach(r) && candidatesFor(r).length > 0 && r.status !== 'match' && (
                          <select
                            aria-label={t('attachTo')}
                            className={selectClass}
                            disabled={readOnly}
                            value={d.attachTo ?? ''}
                            onChange={(e) => {
                              update(r.key, { attachTo: e.target.value || null });
                            }}
                          >
                            <option value="">{t('separate')}</option>
                            {candidatesFor(r).map((c) => (
                              <option key={c.key} value={c.key}>
                                {t(c.direction !== r.direction ? 'legOf' : 'feeOf', {
                                  what: `${fmt.date(c.occurredOn)} ${c.direction === 'in' ? '+' : '−'}${fmt.amount(c.amount, c.currency)} ${(c.counterparty ?? c.purpose ?? '').slice(0, 40)}`,
                                })}
                              </option>
                            ))}
                          </select>
                        )}
                        {!attached && r.status === 'match' && (
                          <span className="text-xs">{t('willLink')}</span>
                        )}
                        {!attached && r.status !== 'match' && (
                          <>
                            <div className="grid grid-cols-2 gap-1.5">
                              <select
                                aria-label={t('type')}
                                className={selectClass}
                                disabled={readOnly}
                                value={d.type}
                                onChange={(e) => {
                                  const type = e.target.value as Decision['type'];
                                  update(r.key, {
                                    type,
                                    categoryId:
                                      categories.find((c) => c.id === d.categoryId)?.txType === type
                                        ? d.categoryId
                                        : null,
                                  });
                                }}
                              >
                                {TYPES.filter((ty) =>
                                  TWO_LEG.has(ty)
                                    ? ty === d.type ||
                                      rows.some((x) => decisions[x.key]?.attachTo === r.key)
                                    : true,
                                ).map((ty) => (
                                  <option key={ty} value={ty}>
                                    {TX_TYPE_LABELS[ty] ?? ty}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={t('category')}
                                className={cn(
                                  selectClass,
                                  !d.categoryId && d.include && 'border-amber-500',
                                )}
                                disabled={readOnly}
                                value={d.categoryId ?? ''}
                                onChange={(e) => {
                                  update(r.key, { categoryId: e.target.value || null });
                                }}
                              >
                                <option value="">{t('chooseCategory')}</option>
                                {categories
                                  .filter((c) => c.txType === d.type)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                              <select
                                aria-label={t('party')}
                                className={cn(selectClass, 'col-span-2')}
                                disabled={readOnly}
                                value={partyValue(d)}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  update(r.key, {
                                    personId: v.startsWith('p:') ? v.slice(2) : null,
                                    clientId: v.startsWith('c:') ? v.slice(2) : null,
                                  });
                                }}
                              >
                                <option value="">{t('noParty')}</option>
                                <optgroup label={t('people')}>
                                  {people.map((p) => (
                                    <option key={p.id} value={`p:${p.id}`}>
                                      {p.name}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label={t('clients')}>
                                  {clients.map((c) => (
                                    <option key={c.id} value={`c:${c.id}`}>
                                      {c.name}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                            {r.network && (
                              <Input
                                aria-label={t('description')}
                                className="h-8"
                                disabled={readOnly}
                                value={d.description ?? ''}
                                placeholder={t('description')}
                                onChange={(e) => {
                                  update(r.key, { description: e.target.value || null });
                                }}
                              />
                            )}
                            {r.suggestion && (
                              <span
                                className="text-xs text-muted-foreground"
                                title={r.suggestion.reason ?? undefined}
                              >
                                {t(`source.${r.suggestion.source}`)} ·{' '}
                                {t(`confidence.${r.suggestion.confidence}`)}
                                {r.suggestion.reason ? ` · ${r.suggestion.reason}` : ''}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
