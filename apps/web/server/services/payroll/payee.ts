import {
  company,
  contract,
  numberSequence,
  payee,
  payrollItem,
  person,
  supplierAct,
} from '@tally/db/schema';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { optionalLocalDate, optionalText } from '../fields';
import { inActorScope } from '../context';
import { ensureMonthlyActDraft, syncMonthlyActDraft } from '../acts';

/**
 * The legal recipient of a payout chosen after the close (A-113): a person without a default
 * payee had none at the close, so a fiat payout had no FOP act. Only an unpaid payout without
 * acts changes; a FOP with a contract gets its draft act at once. "Remember" makes the payee the
 * person's default for the next months. A FOP without a contract gets one here, with the act
 * numbering it needs (`act:<number>`), so the act can be issued straight away.
 */
export const setPayoutPayee = defineService({
  name: 'payroll.setPayee',
  input: z.object({
    itemId: z.uuid(),
    payeeId: z.uuid({ error: 'payroll.choosePayee' }),
    remember: z.preprocess((v) => v === 'on' || v === true, z.boolean()).default(false),
    contractNumber: optionalText,
    contractSignedOn: optionalLocalDate,
    actTemplate: optionalText,
    actNextValue: z.preprocess(
      (v) => (v === '' || v === undefined ? 1 : v),
      z.coerce
        .number({ error: 'field.numberRequired' })
        .int('field.integer')
        .min(1, 'field.atLeastOne'),
    ),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role === 'viewer') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
      const [item] = await tx
        .select()
        .from(payrollItem)
        .where(eq(payrollItem.id, input.itemId))
        .for('update');
      if (!item) return err(serviceError('not_found', 'payroll.notFound'));
      if (item.kind !== 'person' || !item.personId) {
        return err(serviceError('conflict', 'payroll.payeeAgency'));
      }
      const [paid] = await tx.execute<{ paid: boolean }>(
        sql`select exists (select 1 from public.allocation a where a.payroll_item_id = ${item.id}) as paid`,
      );
      if (paid?.paid) return err(serviceError('conflict', 'payroll.payeePaid'));
      const [act] = await tx
        .select({ id: supplierAct.id })
        .from(supplierAct)
        .where(and(eq(supplierAct.payrollItemId, item.id), ne(supplierAct.status, 'void')))
        .limit(1);
      if (act) return err(serviceError('conflict', 'payroll.payeeHasAct'));
      const [chosen] = await tx.select().from(payee).where(eq(payee.id, input.payeeId));
      if (!chosen) return err(serviceError('not_found', 'payroll.choosePayee'));
      if (chosen.kind === 'fop' && item.payoutMethod === 'fiat') {
        const [fop] = await tx
          .select({ id: contract.id })
          .from(contract)
          .where(and(eq(contract.payeeId, chosen.id), eq(contract.kind, 'fop')))
          .limit(1);
        if (!fop) {
          if (!input.contractNumber) {
            return err(
              serviceError('validation_error', 'payroll.payeeNoContract', {
                contractNumber: ['payroll.payeeNoContract'],
              }),
            );
          }
          // Act numbering is the owner's (5.6), as in Settings.
          if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
            return err(serviceError('forbidden', 'payroll.contractOwnerOnly'));
          }
          const template = input.actTemplate ?? `${input.contractNumber} - А{seq}`;
          if (!template.includes('{seq}')) {
            return err(
              serviceError('validation_error', 'settings.templateSeq', {
                actTemplate: ['settings.templateSeq'],
              }),
            );
          }
          const key = `act:${input.contractNumber}`;
          const [taken] = await tx
            .select({ key: numberSequence.key })
            .from(numberSequence)
            .where(eq(numberSequence.key, key));
          if (taken) {
            return err(
              serviceError('conflict', 'payroll.contractNumberTaken', {
                contractNumber: ['payroll.contractNumberTaken'],
              }),
            );
          }
          const [co] = await tx
            .select({ id: company.id })
            .from(company)
            .orderBy(asc(company.createdAt))
            .limit(1);
          if (!co) return err(serviceError('conflict', 'company.missing'));
          await tx
            .insert(numberSequence)
            .values({ key, template, nextValue: input.actNextValue, yearScoped: false });
          await tx.insert(contract).values({
            kind: 'fop',
            number: input.contractNumber,
            signedOn: input.contractSignedOn ?? null,
            companyId: co.id,
            payeeId: chosen.id,
            currency: 'UAH',
            numberSequenceKey: key,
          });
        }
      }
      await tx.update(payrollItem).set({ payeeId: chosen.id }).where(eq(payrollItem.id, item.id));
      if (input.remember) {
        await tx
          .update(person)
          .set({ defaultPayeeId: chosen.id })
          .where(eq(person.id, item.personId));
      }
      const draft = await ensureMonthlyActDraft(tx, item.id);
      if (draft) await syncMonthlyActDraft(tx, item.id);
      return ok({ id: item.id, actId: draft?.id ?? null });
    });
  },
});

/** Recipients a payout can get (A-113): FOPs first, and whether each already has a FOP contract. */
export const payoutPayees = defineService({
  name: 'payroll.payoutPayees',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: payee.id,
          kind: payee.kind,
          name: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`,
          personName: person.fullName,
          hasContract: sql<boolean>`exists (select 1 from ${contract} c where c.payee_id = ${payee.id} and c.kind = 'fop')`,
        })
        .from(payee)
        .leftJoin(person, eq(person.id, payee.personId))
        .where(ne(payee.kind, 'crypto')),
    );
    return ok(
      rows
        .map((r) => ({
          id: r.id,
          fop: r.kind === 'fop',
          hasContract: r.hasContract,
          label: r.personName ? `${r.name} · ${r.personName}` : r.name,
        }))
        .sort((a, b) => Number(b.fop) - Number(a.fop) || a.label.localeCompare(b.label)),
    );
  },
});
