import { payee, person } from '@tally/db/schema';
import { asc, eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import {
  normalizeAddressIn,
  optionalLocalDate,
  optionalNetwork,
  optionalText,
  transferFeeFields,
} from '../fields';

export const PAYEE_KINDS = ['fop', 'crypto', 'other'] as const;

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** IBAN without spaces, upper case; format check only (country + 2 check digits + BBAN). */
const optionalIban = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v),
    z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'payees.iban')
        .nullable()
        .optional(),
    ),
  )
  .transform((v) => v ?? null);

const optionalDigits = z
  .preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .regex(/^\d{8,12}$/, 'payees.taxId')
      .nullable()
      .optional(),
  )
  .transform((v) => v ?? null);

const optionalUuid = z
  .preprocess(emptyToNull, z.uuid().nullable().optional())
  .transform((v) => v ?? null);

export const payeeInput = z
  .object({
    kind: z.enum(PAYEE_KINDS, { error: 'payees.kind' }),
    legalNameUa: optionalText,
    legalNameEn: optionalText,
    taxId: optionalDigits,
    edrRecord: optionalText,
    edrDate: optionalLocalDate,
    addressUa: optionalText,
    iban: optionalIban,
    bankName: optionalText,
    walletAddress: optionalText,
    walletNetwork: optionalNetwork,
    personId: optionalUuid,
    ...transferFeeFields,
  })
  .refine((p) => p.legalNameUa ?? p.legalNameEn, {
    message: 'payees.name',
    path: ['legalNameUa'],
  })
  .refine((p) => p.kind !== 'crypto' || p.walletAddress, {
    message: 'payees.wallet',
    path: ['walletAddress'],
  })
  .transform(normalizeAddressIn('walletNetwork', 'walletAddress'));

export const payeeName = sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

export const listPayees = defineService({
  name: 'payees.list',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: payee.id,
          kind: payee.kind,
          name: payeeName,
          taxId: payee.taxId,
          iban: payee.iban,
          walletNetwork: payee.walletNetwork,
          walletAddress: payee.walletAddress,
          personId: payee.personId,
          personName: person.fullName,
          feeFixed: payee.feeFixed,
          feePercent: payee.feePercent,
          feeCurrency: payee.feeCurrency,
          feeStepFrom: payee.feeStepFrom,
          feeStepFixed: payee.feeStepFixed,
        })
        .from(payee)
        .leftJoin(person, eq(person.id, payee.personId))
        .orderBy(asc(payeeName)),
    );
    return ok(rows);
  },
});

export const getPayee = defineService({
  name: 'payees.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({ payee, personName: person.fullName })
        .from(payee)
        .leftJoin(person, eq(person.id, payee.personId))
        .where(eq(payee.id, id)),
    );
    return row ? ok(row) : err(serviceError('not_found', 'payees.notFound'));
  },
});

export const createPayee = defineService({
  name: 'payees.create',
  input: payeeInput,
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(payee).values(input).returning({ id: payee.id }),
    );
    return row ? ok(row) : err(serviceError('internal_error', 'general.createFailed'));
  },
});

export const updatePayee = defineService({
  name: 'payees.update',
  input: payeeInput.and(z.object({ id: z.uuid() })),
  handler: async (ctx, { id, ...input }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.update(payee).set(input).where(eq(payee.id, id)).returning({ id: payee.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'payees.notFound'));
  },
});

/** Default payee of a person (spec 3: `person.default_payee_id`); `payroll_item.payee_id` is the fact. */
export const setDefaultPayee = defineService({
  name: 'people.setDefaultPayee',
  input: z.object({ personId: z.uuid(), payeeId: optionalUuid }),
  handler: async (ctx, { personId, payeeId }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(person)
        .set({ defaultPayeeId: payeeId })
        .where(eq(person.id, personId))
        .returning({ id: person.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'people.notFound'));
  },
});
