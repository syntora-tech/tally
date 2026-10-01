import { client } from '@tally/db/schema';
import { sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError, msg } from '../errors';
import { definedOnly } from '../patch';
import { currencyCode } from '../fields';
import { clientInput } from './schema';

// Defaults belong to creation only: a patch without the field must keep the stored value.
const clientPatch = clientInput.partial().extend({
  defaultCurrency: currencyCode.optional(),
  id: z.uuid().optional().describe('Client id; without it the client is matched by legalName'),
});

/**
 * Clients in bulk (spec 13.3 `propose_client`, written directly per A-056): matched by id or by
 * legal name (case-insensitive), updated only in the fields sent, created when absent. Contracts
 * and terms stay in the UI.
 */
export const upsertClients = defineService({
  name: 'clients.upsertBatch',
  input: z.object({
    clients: z.array(clientPatch).min(1).max(100),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; legalName: string; status: string }[] = [];
      for (const [index, { id, ...patch }] of input.clients.entries()) {
        const key = `clients.${String(index)}`;
        // Matched by name, the name is the lookup key, not a change; renaming needs the id.
        const values = definedOnly(id ? patch : { ...patch, legalName: undefined });
        const matches = id
          ? await tx
              .select()
              .from(client)
              .where(sql`${client.id} = ${id}`)
          : patch.legalName
            ? await tx
                .select()
                .from(client)
                .where(sql`lower(${client.legalName}) = lower(${patch.legalName})`)
            : [];
        if (matches.length > 1) {
          errors[key] = [msg('clients.ambiguousName', { name: patch.legalName ?? '' })];
          continue;
        }
        const current = matches[0];
        if (!current) {
          if (id) {
            errors[key] = ['clients.idNotFound'];
            continue;
          }
          const full = clientInput.safeParse(patch);
          if (!full.success) {
            errors[key] = full.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
            continue;
          }
          const [row] = await tx.insert(client).values(full.data).returning({ id: client.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          results.push({ index, id: row.id, legalName: full.data.legalName, status: 'created' });
          continue;
        }
        if (Object.keys(values).length) {
          await tx
            .update(client)
            .set(values)
            .where(sql`${client.id} = ${current.id}`);
        }
        results.push({
          index,
          id: current.id,
          legalName: values.legalName ?? current.legalName,
          status: Object.keys(values).length ? 'updated' : 'unchanged',
        });
      }
      if (Object.keys(errors).length) {
        return err(serviceError('validation_error', 'batch.failed', errors));
      }
      return ok({ clients: results });
    }),
});
