import { person } from '@tally/db/schema';
import { sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { definedOnly } from '../patch';
import { PERSON_STATUSES, personProfileInput } from './schema';

// Defaults belong to creation only: a patch without the field must keep the stored value.
const profilePatch = personProfileInput.partial().extend({
  status: z.enum(PERSON_STATUSES).optional(),
  id: z.uuid().optional().describe('Person id; without it the person is matched by fullName'),
});

/**
 * Bench profiles in bulk (spec 13.3 `upsert_person_profile`): matched by id or by full name
 * (case-insensitive), updated only in the fields sent, created when absent. Payees and terms are
 * out of reach by design.
 */
export const upsertPeople = defineService({
  name: 'people.upsertBatch',
  input: z.object({
    people: z.array(profilePatch).min(1).max(200),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; fullName: string; status: string }[] = [];
      for (const [index, { id, ...patch }] of input.people.entries()) {
        const key = `people.${String(index)}`;
        // Matched by name, the name is the lookup key, not a change; renaming needs the id.
        const values = definedOnly(id ? patch : { ...patch, fullName: undefined });
        const matches = id
          ? await tx
              .select()
              .from(person)
              .where(sql`${person.id} = ${id}`)
          : patch.fullName
            ? await tx
                .select()
                .from(person)
                .where(sql`lower(${person.fullName}) = lower(${patch.fullName})`)
            : [];
        if (matches.length > 1) {
          errors[key] = [`Кілька людей з ім'ям «${patch.fullName ?? ''}» — передайте id`];
          continue;
        }
        const current = matches[0];
        if (!current) {
          if (id) {
            errors[key] = ['Людину з таким id не знайдено'];
            continue;
          }
          const full = personProfileInput.safeParse(patch);
          if (!full.success) {
            errors[key] = full.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
            continue;
          }
          const [row] = await tx.insert(person).values(full.data).returning({ id: person.id });
          if (!row) return err(serviceError('forbidden', 'Недостатньо прав для цієї дії'));
          results.push({ index, id: row.id, fullName: full.data.fullName, status: 'created' });
          continue;
        }
        if (Object.keys(values).length) {
          await tx
            .update(person)
            .set(values)
            .where(sql`${person.id} = ${current.id}`);
        }
        results.push({
          index,
          id: current.id,
          fullName: values.fullName ?? current.fullName,
          status: Object.keys(values).length ? 'updated' : 'unchanged',
        });
      }
      if (Object.keys(errors).length) {
        return err(serviceError('validation_error', 'Пакет не записано: є помилки', errors));
      }
      return ok({ people: results });
    }),
});
