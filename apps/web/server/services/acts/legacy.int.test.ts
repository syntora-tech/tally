import { randomUUID } from 'node:crypto';
import { company, contract, document, documentLink, payee, supplierAct } from '@tally/db/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { addLegacyActs } from './legacy';
import { actsRegistry } from './registry';

const h = intHarness();
let finance: Awaited<ReturnType<typeof h.user>>;
const tag = randomUUID().slice(0, 8);
const ids = { company: '', payee: '', contract: '', clientContract: '', document: '' };

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Legacy acts test', nameUa: 'Тест' })
    .returning();
  const [p] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: `ФОП Історія ${tag}` })
    .returning();
  ids.company = co?.id ?? '';
  ids.payee = p?.id ?? '';
  const [c] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: `OD-${tag}`, companyId: ids.company, payeeId: ids.payee })
    .returning();
  ids.contract = c?.id ?? '';
  const [doc] = await h.db
    .insert(document)
    .values({ type: 'act', title: `Акт ${tag}`, number: `OD-${tag}-A1` })
    .returning();
  ids.document = doc?.id ?? '';
});

afterAll(async () =>
  h.cleanup(async (db) => {
    await db.delete(document).where(eq(document.id, ids.document));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.payeeId, ids.payee));
    });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const act = (ref: string, over: Record<string, unknown> = {}) => ({
  legacyRef: `test:${tag}:${ref}`,
  contractId: ids.contract,
  number: `${tag} - А1`,
  actDate: '2025-11-30',
  amountUah: '167320',
  periodFrom: '2025-11-01',
  periodTo: '2025-11-30',
  ...over,
});

describe('historical FOP acts (A-088)', () => {
  it('previews without writing, then enters issued legacy acts linked to their documents', async () => {
    const batch = [
      act('a', {
        actDate: '2025-11-20',
        periodFrom: '2025-10-01',
        periodTo: '2025-10-31',
        documentIds: [ids.document],
      }),
      // The old numbering reused a number for the next month: both acts are kept.
      act('b'),
    ];
    const preview = (
      await addLegacyActs.run(h.ctxFor(finance), { acts: batch, dryRun: true })
    )._unsafeUnwrap();
    expect(preview.results.map((r) => r.status)).toEqual(['created', 'created']);
    expect(await h.db.select().from(supplierAct).where(eq(supplierAct.payeeId, ids.payee))).toEqual(
      [],
    );

    const saved = (await addLegacyActs.run(h.ctxFor(finance), { acts: batch }))._unsafeUnwrap();
    expect(saved.results).toMatchObject([
      { status: 'created', linkedDocuments: 1 },
      { status: 'created', linkedDocuments: 0 },
    ]);
    const rows = await h.db
      .select({ isLegacy: supplierAct.isLegacy, status: supplierAct.status })
      .from(supplierAct)
      .where(eq(supplierAct.payeeId, ids.payee));
    expect(rows.every((r) => r.isLegacy && r.status === 'issued')).toBe(true);
    const links = await h.db
      .select()
      .from(documentLink)
      .where(eq(documentLink.documentId, ids.document));
    expect(links).toMatchObject([{ entityType: 'supplier_act', entityId: saved.results[0]?.id }]);

    const registry = (
      await actsRegistry.run(h.ctxFor(finance), { payeeId: ids.payee, year: '2025' })
    )._unsafeUnwrap();
    expect(registry.groups[0]).toMatchObject({ total: '334640.00', missing: [] });
  });

  it('re-sent items are existing; other values for a known ref or a client contract are errors', async () => {
    const again = (
      await addLegacyActs.run(h.ctxFor(finance), { acts: [act('b', { amountUah: '167320.00' })] })
    )._unsafeUnwrap();
    expect(again.results[0]?.status).toBe('existing');

    const changed = (
      await addLegacyActs.run(h.ctxFor(finance), { acts: [act('b', { amountUah: '1' })] })
    )._unsafeUnwrapErr();
    expect(changed.fieldErrors?.['acts.0']?.[0]).toContain('acts.legacyChanged');

    const wrong = (
      await addLegacyActs.run(h.ctxFor(finance), {
        acts: [act('c', { contractId: randomUUID(), periodFrom: '2025-12-01' })],
      })
    )._unsafeUnwrapErr();
    expect(wrong.fieldErrors?.['acts.0']).toEqual(['acts.chooseFopContract', 'acts.legacyPeriod']);
  });
});
