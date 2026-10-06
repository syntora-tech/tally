import { z } from 'zod';
import { currencyCode, optionalLocalDate, optionalText, requiredText } from '../fields';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const contactInput = z.object({
  name: z.string().trim().min(1, 'clients.contactName'),
  role: z.string().trim().optional(),
  email: z.union([z.email('field.email'), z.literal('')]).optional(),
  phone: z.string().trim().optional(),
});

/** Contacts arrive from the form as a JSON string, from MCP as an array. */
const contactList = z.preprocess((v) => {
  if (typeof v !== 'string') return v ?? [];
  if (v.trim() === '') return [];
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}, z.array(contactInput).max(20));

export const clientInput = z.object({
  legalName: requiredText('clients.legalName'),
  shortName: optionalText,
  address: optionalText,
  country: optionalText,
  bankDetails: optionalText,
  contacts: contactList,
  defaultCurrency: currencyCode.default('USD'),
});

// Date and payment rules (spec 5.5); the calendar math arrives with WorkCalendar in stage 2.
export const paymentDueRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('day_of_month'), day: z.coerce.number().int().min(1).max(31) }),
  z.object({ type: z.literal('net_days'), days: z.coerce.number().int().min(1).max(365) }),
  z.object({
    type: z.literal('net_working_days'),
    days: z.coerce.number().int().min(1).max(260),
  }),
]);

export const invoiceDateRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('first_working_day_after_period') }),
  z.object({
    type: z.literal('nth_working_day_after_period'),
    n: z.coerce.number().int().min(1).max(23),
  }),
]);

export const actDateRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('last_working_day_of_period') }),
  z.object({
    type: z.literal('nth_working_day_after_period'),
    n: z.coerce.number().int().min(1).max(23),
  }),
  z.object({ type: z.literal('manual') }),
]);

export const CONTRACT_STATUSES = ['active', 'ended'] as const;

export const contractInput = z
  .object({
    kind: z.enum(['client', 'fop']),
    number: requiredText('contracts.number'),
    signedOn: optionalLocalDate,
    clientId: z.preprocess(emptyToNull, z.uuid().nullable().optional()).transform((v) => v ?? null),
    payeeId: z.preprocess(emptyToNull, z.uuid().nullable().optional()).transform((v) => v ?? null),
    currency: currencyCode.default('USD'),
    paymentDueRule: paymentDueRule.default({ type: 'day_of_month', day: 20 }),
    invoiceDateRule: invoiceDateRule.default({ type: 'first_working_day_after_period' }),
    actDateRule: actDateRule.default({ type: 'last_working_day_of_period' }),
    invoiceTemplateFileId: optionalText,
    actTemplateFileId: optionalText,
    numberSequenceKey: optionalText,
    status: z.enum(CONTRACT_STATUSES).default('active'),
  })
  .refine((c) => (c.kind === 'client' ? c.clientId && !c.payeeId : c.payeeId && !c.clientId), {
    message: 'contracts.counterparty',
    path: ['kind'],
  });

export type ContractInput = z.output<typeof contractInput>;
