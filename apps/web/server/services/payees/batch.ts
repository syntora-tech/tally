import { payee, person } from '@tally/db/schema';
import { eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { CRYPTO_NETWORK_HINT } from '../fields';
import { definedOnly } from '../patch';
import { PAYEE_KINDS, payeeInput } from '.';

const text = (description: string) => z.string().trim().nullable().optional().describe(description);

const payeePatch = z.object({
  id: z.uuid().optional().describe('Payee id; without it the payee is matched by taxId'),
  kind: z.enum(PAYEE_KINDS).optional().describe('fop (Ukrainian sole trader), crypto or other'),
  legalNameUa: text('Legal name in Ukrainian, e.g. "ФОП Іваненко Іван Іванович"'),
  legalNameEn: text('Legal name in English'),
  taxId: text('ІПН / ЄДРПОУ, 8–12 digits; the match key without id'),
  edrRecord: text('EDR record number'),
  edrDate: text('EDR registration date, YYYY-MM-DD'),
  addressUa: text('Registered address in Ukrainian'),
  iban: text('IBAN, spaces allowed'),
  bankName: text('Bank name'),
  walletAddress: text('Payout wallet address (kind crypto)'),
  walletNetwork: text(`Payout wallet network: ${CRYPTO_NETWORK_HINT}`),
  feeFixed: text('Bank fee per payout, fixed part, decimal string (A-082)'),
  feePercent: text('Bank fee per payout, percent of the amount, 0–100'),
  feeCurrency: text(
    'Currency the bank charges the fee in, e.g. UAH for a USD SWIFT; null = payout currency',
  ),
  feeStepFrom: text('Tariff step: from this payout amount the fixed fee is feeStepFixed'),
  feeStepFixed: text('Fixed fee from feeStepFrom on, e.g. "15" (PrivatBank: 15 UAH from 100 000)'),
  personId: z
    .uuid()
    .nullable()
    .optional()
    .describe('Person this payee pays (from search_people); null unlinks'),
  makeDefault: z
    .boolean()
    .optional()
    .describe('Also make it the default payee of personId (used for new payouts)'),
});

/**
 * Payees in bulk for agents (A-062): matched by id, else by tax id; only the fields sent change,
 * a missing payee is created. A payee can be linked to a person and made their default payee.
 * Payee data stays finance-only; deletion is UI-only.
 */
export const upsertPayees = defineService({
  name: 'payees.upsertBatch',
  input: z.object({
    payees: z.array(payeePatch).min(1).max(100),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; status: 'created' | 'updated' | 'unchanged' }[] =
        [];
      for (const [index, { id, makeDefault, ...patch }] of input.payees.entries()) {
        const key = `payees.${String(index)}`;
        const matches = id
          ? await tx.select().from(payee).where(eq(payee.id, id))
          : patch.taxId
            ? await tx
                .select()
                .from(payee)
                .where(sql`${payee.taxId} = ${patch.taxId.trim()}`)
            : [];
        if (matches.length > 1) {
          errors[key] = [msg('payees.ambiguousTaxId', { taxId: patch.taxId ?? '' })];
          continue;
        }
        const current = matches[0];
        if (id && !current) {
          errors[key] = ['payees.notFound'];
          continue;
        }
        const merged = { ...(current ?? {}), ...definedOnly(patch) };
        const parsed = payeeInput.safeParse({ kind: 'fop', ...merged });
        if (!parsed.success) {
          errors[key] = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          continue;
        }
        if (makeDefault && !parsed.data.personId) {
          errors[key] = ['payees.defaultNeedsPerson'];
          continue;
        }
        let payeeId = current?.id;
        let status: 'created' | 'updated' | 'unchanged' = 'unchanged';
        if (!current) {
          const [row] = await tx.insert(payee).values(parsed.data).returning({ id: payee.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          payeeId = row.id;
          status = 'created';
        } else {
          const changed = (Object.keys(parsed.data) as (keyof typeof parsed.data)[]).some(
            (k) => current[k] !== parsed.data[k],
          );
          if (changed) {
            await tx.update(payee).set(parsed.data).where(eq(payee.id, current.id));
            status = 'updated';
          }
        }
        if (makeDefault && payeeId && parsed.data.personId) {
          const [owner] = await tx
            .update(person)
            .set({ defaultPayeeId: payeeId })
            .where(eq(person.id, parsed.data.personId))
            .returning({ id: person.id });
          if (!owner) {
            errors[key] = ['people.notFound'];
            continue;
          }
          if (status === 'unchanged') status = 'updated';
        }
        if (payeeId) results.push({ index, id: payeeId, status });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ payees: results });
    }),
});
