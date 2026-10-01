import { company } from '@tally/db/schema';
import { asc, eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { optionalText, requiredText } from '../fields';

export const companyInput = z.object({
  nameEn: requiredText('company.nameEn'),
  nameUa: requiredText('company.nameUa'),
  legalCode: optionalText,
  addressEn: optionalText,
  addressUa: optionalText,
  directorEn: optionalText,
  directorUa: optionalText,
  bankDetailsEn: optionalText,
  bankDetailsUa: optionalText,
});

/** v1 has a single legal entity (ТОВ «СІНТОРА»); the oldest row is the company. */
export const getCompany = defineService({
  name: 'company.get',
  input: z.object({}),
  handler: async (ctx) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.select().from(company).orderBy(asc(company.createdAt)).limit(1),
    );
    return ok(row ?? null);
  },
});

/** Settings → company requisites (6.10); RLS lets only the owner write. */
export const saveCompany = defineService({
  name: 'company.save',
  input: companyInput,
  handler: async (ctx, input) => {
    const saved = await inActorScope(ctx, async (tx) => {
      const [existing] = await tx
        .select({ id: company.id })
        .from(company)
        .orderBy(asc(company.createdAt))
        .limit(1);
      const [row] = existing
        ? await tx
            .update(company)
            .set(input)
            .where(eq(company.id, existing.id))
            .returning({ id: company.id })
        : await tx.insert(company).values(input).returning({ id: company.id });
      return row;
    });
    return saved ? ok(saved) : err(serviceError('forbidden', 'general.forbidden'));
  },
});
