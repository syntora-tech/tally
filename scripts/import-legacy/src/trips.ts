import { roundHalfUp, toDecimal, type LocalDate } from '@tally/domain';
import type { Aliases } from './aliases';
import type { Anomaly } from './model';
import type { TripSheet } from './sources/trips';

export type TripExpenseRec = {
  ref: string;
  spentOn: LocalDate | null;
  description: string;
  amount: string;
  currency: string;
  fxRate: string;
  amountUah: string;
  amountUsd: string;
  reimbursable: boolean;
};

export type TripRec = {
  ref: string;
  sheet: string;
  title: string;
  location: string | null;
  startsOn: LocalDate | null;
  endsOn: LocalDate | null;
  participant: string;
  expenses: TripExpenseRec[];
  reimbursement: { ref: string; act: string } | { ref: string; note: string } | null;
};

export type TripsModel = { trips: TripRec[]; anomalies: Anomaly[]; unmapped: string[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** USD per the sheet's own rates block (units per 1 USD); stablecoins and USD are at par. */
function sheetUsd(amount: string, currency: string, rates: Record<string, string>): string | null {
  if (['USD', 'USDT', 'USDC'].includes(currency)) return toDecimal(amount).toFixed(8);
  const perUsd = rates[currency];
  return perUsd ? toDecimal(amount).div(perUsd).toFixed(8) : null;
}

/**
 * Trips from the `Business_trips` sheets (spec 8.1, A-070). Only sheets listed in
 * `aliases.trips` are imported; their config adds what the xlsx lacks. Values follow the sheet:
 * USD from "Cost In USD", UAH from the UAH column or the sheet's rate, card rows as they were
 * charged.
 */
export function buildTripsModel(sheets: TripSheet[], aliases: Aliases): TripsModel {
  const anomalies: Anomaly[] = [];
  const unmapped: string[] = [];
  const trips: TripRec[] = [];
  for (const s of sheets) {
    const cfg = aliases.trips[s.sheet];
    if (!cfg) {
      unmapped.push(s.sheet);
      continue;
    }
    const uahPerUsd = s.rates.UAH;
    const expenses: TripExpenseRec[] = [];
    for (const row of s.rows) {
      if (cfg.cards && cfg.cardReplaces.some((r) => same(r, row.service))) continue;
      const usd = row.costUsd ?? sheetUsd(row.cost, row.currency, s.rates);
      const uah =
        (!cfg.ignoreUah && row.uah) ||
        (row.currency === 'UAH'
          ? row.cost
          : usd && uahPerUsd
            ? roundHalfUp(toDecimal(usd).times(uahPerUsd), 2).toFixed(2)
            : null);
      if (!usd || !uah) {
        anomalies.push({
          code: 'TRIP',
          ref: row.ref,
          message: `No rate for ${row.currency}; row skipped`,
        });
        continue;
      }
      const overridden = !row.compensate && cfg.reimbursable.some((r) => same(r, row.service));
      if (overridden) {
        anomalies.push({
          code: 'A14',
          ref: row.ref,
          message: `"${row.service}" is marked "No" in the sheet but imported as reimbursable (${uah} UAH)`,
        });
      }
      expenses.push({
        ref: row.ref,
        spentOn: null,
        description: row.service,
        amount: row.cost,
        currency: row.currency,
        fxRate: toDecimal(uah).div(row.cost).toFixed(6),
        amountUah: toDecimal(uah).toFixed(2),
        amountUsd: toDecimal(usd).toFixed(8),
        reimbursable: row.compensate || overridden,
      });
    }
    if (cfg.cards) {
      for (const card of s.cards) {
        const usd = sheetUsd(card.amount, card.currency, s.rates);
        if (!usd) {
          anomalies.push({ code: 'TRIP', ref: card.ref, message: `No rate for ${card.currency}` });
          continue;
        }
        expenses.push({
          ref: card.ref,
          spentOn: card.on,
          description:
            card.note && !same(card.note, card.details)
              ? `${card.details} — ${card.note}`
              : card.details,
          amount: card.amount,
          currency: card.currency,
          fxRate: card.rate ?? toDecimal(card.uah).div(card.amount).toFixed(6),
          amountUah: toDecimal(card.uah).toFixed(2),
          amountUsd: usd,
          reimbursable: true,
        });
      }
    } else if (s.cards.length) {
      anomalies.push({
        code: 'TRIP',
        ref: s.sheet,
        message: `${String(s.cards.length)} card rows on this sheet belong to another trip; skipped`,
      });
    }
    if (cfg.ignoreUah) {
      anomalies.push({
        code: 'TRIP',
        ref: s.sheet,
        message:
          'UAH column ignored (copied from another sheet); UAH recomputed from the sheet rate',
      });
    }
    const startsOn = (cfg.startsOn ?? null) as LocalDate | null;
    const endsOn = (cfg.endsOn ?? null) as LocalDate | null;
    if (!startsOn || !endsOn) {
      anomalies.push({
        code: 'TRIP',
        ref: s.sheet,
        message: 'No dates in the file: fill them in the trip card',
      });
    }
    const ref = `trips:${s.sheet}`;
    trips.push({
      ref,
      sheet: s.sheet,
      title: cfg.title ?? s.title,
      location: cfg.location ?? null,
      startsOn,
      endsOn,
      participant: cfg.participant,
      expenses,
      reimbursement: cfg.act
        ? { ref: `${ref}:reimbursement`, act: cfg.act }
        : cfg.compensated
          ? { ref: `${ref}:reimbursement`, note: cfg.compensated }
          : null,
    });
  }
  return { trips, anomalies, unmapped };
}
