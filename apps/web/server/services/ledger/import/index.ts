import { ledgerImport } from '@tally/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../../context';
import { defineService } from '../../define-service';
import { serviceError } from '../../errors';
import { importRows } from './rows';

export { prepareBankImport } from './bank';
export { prepareCryptoImport } from './crypto';
export { suggestImportWithAi } from './ai';
export { commitImport } from './commit';
export { includedByDefault, isBookable, type Decision, type ImportRow } from './rows';

export const getImport = defineService({
  name: 'ledger.import.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.select().from(ledgerImport).where(eq(ledgerImport.id, id)),
    );
    if (!row) return err(serviceError('not_found', 'import.notFound'));
    return ok({ ...row, rows: importRows.parse(row.rows) });
  },
});

export const listImports = defineService({
  name: 'ledger.import.list',
  input: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  handler: async (ctx, { limit }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select({
            id: ledgerImport.id,
            kind: ledgerImport.kind,
            status: ledgerImport.status,
            sources: ledgerImport.sources,
            summary: ledgerImport.summary,
            createdAt: ledgerImport.createdAt,
            committedAt: ledgerImport.committedAt,
          })
          .from(ledgerImport)
          .orderBy(desc(ledgerImport.createdAt))
          .limit(limit),
      ),
    ),
});

/** Drops a draft without booking anything; the record stays as discarded. */
export const discardImport = defineService({
  name: 'ledger.import.discard',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(ledgerImport)
        .set({ status: 'discarded' })
        .where(and(eq(ledgerImport.id, id), eq(ledgerImport.status, 'draft')))
        .returning({ id: ledgerImport.id }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'import.notDraft'));
  },
});
