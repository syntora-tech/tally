import 'server-only';
import { company, contract, payee, payrollItem, supplierAct } from '@tally/db/schema';
import type { LocalDate } from '@tally/domain';
import { and, asc, eq, ne } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { actFileName } from '../../jobs/render-act';
import { getDocumentStorage } from '../../storage';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { insertDocumentRow, storeDocumentFile, uploadFile } from '../documents';
import { serviceError } from '../errors';
import { checkbox, localDateString, optionalHttpUrl, optionalText, requiredText } from '../fields';
import { buildActSnapshot } from './snapshot';

const actPdf = uploadFile.refine(
  (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  'acts.documentPdf',
);

/**
 * Issues a draft act with a document made outside Tally (A-101): the number is the one on the
 * document, typed in, so the contract's sequence does not move; the PDF is filed instead of one
 * rendered from the template. An already signed document lets the payout be paid (A-096).
 */
export const issueActWithDocument = defineService({
  name: 'acts.issueWithDocument',
  input: z.object({
    id: z.uuid(),
    number: requiredText('field.numberRequired'),
    actDate: localDateString,
    dateOverrideReason: optionalText,
    file: actPdf,
    signed: checkbox,
    signedUrl: optionalHttpUrl,
  }),
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({ act: supplierAct, contract, payee, personId: payrollItem.personId })
        .from(supplierAct)
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .leftJoin(payrollItem, eq(payrollItem.id, supplierAct.payrollItemId))
        .where(eq(supplierAct.id, input.id)),
    );
    if (!row) return err(serviceError('not_found', 'acts.notFound'));
    if (row.act.status !== 'draft') return err(serviceError('conflict', 'acts.alreadyIssued'));
    const taken = await inActorScope(ctx, (tx) =>
      tx
        .select({ id: supplierAct.id })
        .from(supplierAct)
        .where(
          and(
            eq(supplierAct.contractId, row.act.contractId),
            eq(supplierAct.number, input.number),
            ne(supplierAct.status, 'draft'),
            eq(supplierAct.isLegacy, false),
          ),
        ),
    );
    if (taken.length) {
      return err(
        serviceError('validation_error', 'acts.numberTaken', { number: ['acts.numberTaken'] }),
      );
    }
    const [co] = await inActorScope(ctx, (tx) =>
      tx.select().from(company).orderBy(asc(company.createdAt)).limit(1),
    );
    if (!co) return err(serviceError('conflict', 'company.missingShort'));

    // The upload runs outside the transaction; the document row and the issue commit together.
    const links = [
      { entityType: 'payee' as const, entityId: row.act.payeeId },
      { entityType: 'supplier_act' as const, entityId: row.act.id },
      ...(row.personId ? [{ entityType: 'person' as const, entityId: row.personId }] : []),
    ];
    const stored = await storeDocumentFile(ctx, getDocumentStorage(), {
      type: 'act',
      docDate: input.actDate,
      links,
      file: input.file,
    });
    return inActorScope(ctx, async (tx) => {
      const filed = await insertDocumentRow(
        tx,
        {
          type: 'act',
          title: actFileName(input.number, input.actDate),
          number: input.number,
          docDate: input.actDate,
          url: input.signedUrl ?? null,
          notes: null,
          links,
          ...(input.signed && { signedAt: new Date() }),
        },
        stored,
      );
      const snapshot = buildActSnapshot({
        number: input.number,
        actDate: input.actDate,
        periodFrom: row.act.periodFrom as LocalDate | null,
        periodTo: row.act.periodTo as LocalDate | null,
        amountUah: row.act.amountUah,
        company: co,
        contract: {
          number: row.contract.number,
          signedOn: row.contract.signedOn as LocalDate | null,
        },
        payee: { ...row.payee, edrDate: row.payee.edrDate as LocalDate | null },
      });
      await tx
        .update(supplierAct)
        .set({
          status: 'issued',
          number: input.number,
          actDate: input.actDate,
          dateOverrideReason: input.dateOverrideReason,
          // Marks the file as uploaded, not rendered from this snapshot.
          snapshot: { ...snapshot, uploaded: true },
          pdfFileId: stored.key,
          ...(input.signed && { signedDocumentId: filed.id }),
          ...(input.signedUrl && { signedUrl: input.signedUrl }),
        })
        .where(eq(supplierAct.id, row.act.id));
      return ok({ id: row.act.id, number: input.number, documentId: filed.id });
    });
  },
});

/** The signed copy of an issued act, uploaded instead of a Vchasno link (A-101). */
export const attachSignedAct = defineService({
  name: 'acts.attachSigned',
  input: z.object({ id: z.uuid(), file: actPdf }),
  handler: async (ctx, { id, file }) => {
    const [act] = await inActorScope(ctx, (tx) =>
      tx.select().from(supplierAct).where(eq(supplierAct.id, id)),
    );
    if (act?.status !== 'issued' || !act.number) {
      return err(serviceError('conflict', 'acts.linkIssuedOnly'));
    }
    const number = act.number;
    const links = [
      { entityType: 'payee' as const, entityId: act.payeeId },
      { entityType: 'supplier_act' as const, entityId: act.id },
    ];
    const stored = await storeDocumentFile(ctx, getDocumentStorage(), {
      type: 'act',
      docDate: act.actDate as LocalDate,
      links,
      file,
    });
    return inActorScope(ctx, async (tx) => {
      const filed = await insertDocumentRow(
        tx,
        {
          type: 'act',
          title: `${actFileName(number, act.actDate)} (signed)`,
          number,
          docDate: act.actDate as LocalDate,
          url: null,
          notes: null,
          links,
          signedAt: new Date(),
        },
        stored,
      );
      await tx
        .update(supplierAct)
        .set({ signedDocumentId: filed.id })
        .where(eq(supplierAct.id, id));
      return ok({ id, documentId: filed.id });
    });
  },
});
