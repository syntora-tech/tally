import type { LocalDate } from '@tally/domain';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange';

const responseSchema = z.array(
  z.object({ cc: z.string(), rate: z.number().positive(), exchangedate: z.string() }),
);

export type NbuRate = { currency: string; onDate: LocalDate; rate: string };
export type NbuError = { code: 'nbu_unavailable' | 'nbu_no_rate'; message: string };

export type Fetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Official NBU rate (UAH per 1 unit) for a date (5.4). The JSON number is turned into its shortest
 * decimal string right away, so it never takes part in float arithmetic.
 */
export async function fetchNbuRate(
  currency: string,
  onDate: LocalDate,
  fetcher: Fetcher = (u) => fetch(u, { signal: AbortSignal.timeout(4000) }),
): Promise<Result<NbuRate, NbuError>> {
  const url = `${NBU_URL}?valcode=${encodeURIComponent(currency)}&date=${onDate.replaceAll('-', '')}&json`;
  let body: unknown;
  try {
    const res = await fetcher(url);
    if (!res.ok)
      return err({ code: 'nbu_unavailable', message: `NBU responded ${String(res.status)}` });
    body = await res.json();
  } catch (error) {
    return err({
      code: 'nbu_unavailable',
      message: error instanceof Error ? error.message : 'fetch failed',
    });
  }
  const parsed = responseSchema.safeParse(body);
  const row = parsed.success ? parsed.data.find((r) => r.cc === currency) : undefined;
  if (!row)
    return err({ code: 'nbu_no_rate', message: `No NBU rate for ${currency} on ${onDate}` });
  return ok({ currency, onDate, rate: String(row.rate) });
}
