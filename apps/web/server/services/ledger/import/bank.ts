import { createHash } from 'node:crypto';
import { account, ledgerImport } from '@tally/db/schema';
import {
  accountTail,
  pairStatementRows,
  parseCsvTable,
  parseStatementTable,
  statementExternalRef,
  type LocalDate,
  type ParsedStatement,
} from '@tally/domain';
import { desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { readXlsxFirstSheet } from '../../../xlsx-read';
import { inActorScope } from '../../context';
import { defineService } from '../../define-service';
import { msg, serviceError, type ServiceError } from '../../errors';
import { MAX_UPLOAD_BYTES } from '../../documents';
import { checkAgainstLedger, insertDraft, sortRows, suggestFromLedger } from './prepare';
import { MAX_IMPORT_ROWS, type ImportRow } from './rows';

const statementFile = z
  .instanceof(File, { error: 'import.chooseFile' })
  .refine((f) => f.size > 0, 'documents.emptyFile');

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const bankImportInput = z.object({
  files: z
    .preprocess(
      (v: unknown) =>
        (Array.isArray(v) ? (v as unknown[]) : [v]).filter(
          (f) => !(f instanceof File && f.size === 0),
        ),
      z.array(statementFile).min(1, 'import.chooseFile').max(6, 'import.tooManyFiles'),
    )
    .refine(
      (files) => files.reduce((n, f) => n + f.size, 0) <= MAX_UPLOAD_BYTES,
      'documents.tooLarge',
    ),
  /** One account for all files; empty = detect from the file. */
  accountId: z.preprocess(emptyToUndefined, z.uuid().optional()),
});

const fileError = (key: string, values: Record<string, string>): ServiceError =>
  serviceError('validation_error', msg(key, values), { files: [msg(key, values)] });

/**
 * CSV in UTF-8 or Windows-1251 (older Privat24 exports), or the first sheet of an .xlsx; one
 * statement per account the file has rows of.
 */
export function readStatementFile(
  name: string,
  bytes: Buffer,
): Result<ParsedStatement[], ServiceError> {
  let table: string[][];
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const sheet = readXlsxFirstSheet(bytes);
    if (sheet.isErr()) return err(fileError('import.unreadable', { file: name }));
    table = sheet.value;
  } else if (
    bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) ||
    /^\s*<(!doctype|html|table)/i.test(bytes.subarray(0, 200).toString('latin1'))
  ) {
    return err(fileError('import.legacyXls', { file: name }));
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1251').decode(bytes);
    }
    table = parseCsvTable(text);
  }
  const parsed = parseStatementTable(table);
  if (parsed.isOk()) return ok(parsed.value);
  switch (parsed.error.code) {
    case 'empty':
      return err(fileError('import.emptyStatement', { file: name }));
    case 'unknown_format':
      return err(
        fileError('import.unknownFormat', {
          file: name,
          headers: parsed.error.headers.slice(0, 12).join(' | '),
        }),
      );
  }
}

type BankSource = {
  file: string;
  sha256: string;
  accountId: string;
  ourAccount: string | null;
  currency: string | null;
  from: string | null;
  to: string | null;
  rows: number;
  skipped: number;
  overlapping: number;
  columns: ParsedStatement['columns'];
  problems: ParsedStatement['problems'];
};

/**
 * Reads up to six statements (any accounts, any period; A-126) into a draft import (A-121). Nothing
 * is booked here: the draft shows which rows are new, already in the Ledger, or the second leg
 * or fee of another row, with suggestions; `commitImport` books what the person confirms.
 */
export const prepareBankImport = defineService({
  name: 'ledger.import.prepareBank',
  input: bankImportInput,
  handler: async (ctx, input) => {
    const files = await Promise.all(
      input.files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })),
    );
    const parsed: {
      index: number;
      name: string;
      sha256: string;
      statement: ParsedStatement;
    }[] = [];
    for (const [index, f] of files.entries()) {
      const statements = readStatementFile(f.name, f.bytes);
      if (statements.isErr()) return err(statements.error);
      const sha256 = createHash('sha256').update(f.bytes).digest('hex');
      if (parsed.some((p) => p.sha256 === sha256))
        return err(fileError('import.sameFile', { file: f.name }));
      if (input.accountId && statements.value.length > 1) {
        return err(
          fileError('import.mixedAccounts', {
            file: f.name,
            accounts: statements.value.map((s) => s.ourAccount ?? '?').join(', '),
          }),
        );
      }
      for (const statement of statements.value)
        parsed.push({ index, name: f.name, sha256, statement });
    }
    return inActorScope(ctx, async (tx) => {
      const banks = await tx
        .select({
          id: account.id,
          name: account.name,
          currency: account.currency,
          kind: account.kind,
        })
        .from(account)
        .where(eq(account.isActive, true));
      const previous = await tx
        .select({ sources: ledgerImport.sources })
        .from(ledgerImport)
        .where(eq(ledgerImport.kind, 'bank'))
        .orderBy(desc(ledgerImport.createdAt))
        .limit(50);
      const remembered = new Map<string, string>();
      for (const p of previous.reverse()) {
        for (const s of p.sources as Partial<BankSource>[]) {
          if (s.ourAccount && s.accountId) remembered.set(s.ourAccount, s.accountId);
        }
      }

      const rows: ImportRow[] = [];
      const sources: BankSource[] = [];
      const seenRefs = new Set<string>();
      for (const p of parsed) {
        const { statement } = p;
        const chosen = input.accountId
          ? banks.find((b) => b.id === input.accountId)
          : ((statement.ourAccount &&
              banks.find((b) => b.id === remembered.get(statement.ourAccount ?? ''))) ??
            (() => {
              const byCurrency = banks.filter(
                (b) => b.kind === 'bank' && b.currency === statement.currency,
              );
              return byCurrency.length === 1 ? byCurrency[0] : undefined;
            })());
        if (!chosen) {
          return err(
            fileError('import.chooseAccount', {
              file: statement.ourAccount ? `${p.name} (${statement.ourAccount})` : p.name,
            }),
          );
        }
        // Two accounts of one file guessed into the same Tally account would merge their rows.
        const twin = sources.find((s) => s.sha256 === p.sha256 && s.accountId === chosen.id);
        if (twin) {
          return err(
            fileError('import.accountsCollide', {
              file: p.name,
              accounts: [twin.ourAccount, statement.ourAccount].map((a) => a ?? '?').join(', '),
              account: chosen.name,
            }),
          );
        }
        if (statement.currency && statement.currency !== chosen.currency) {
          return err(
            fileError('import.currencyMismatch', {
              file: p.name,
              currency: statement.currency,
              account: chosen.name,
            }),
          );
        }
        const tail = accountTail(statement.ourAccount);
        const debitRefs = new Set(
          statement.rows
            .filter((r) => r.direction === 'out')
            .map((r) => statementExternalRef(r, tail)),
        );
        let overlapping = 0;
        for (const r of statement.rows) {
          const plainRef = statementExternalRef(r, tail);
          // A bank return keeps the number, date and amount of the rejected payment.
          const externalRef =
            r.direction === 'in' && debitRefs.has(plainRef) ? `${plainRef}:in` : plainRef;
          // Overlapping statements repeat the same bank rows; the first copy counts.
          if (seenRefs.has(externalRef)) {
            overlapping++;
            continue;
          }
          seenRefs.add(externalRef);
          rows.push({
            key: `${String(p.index)}:${String(r.line)}`,
            accountId: chosen.id,
            occurredOn: r.occurredOn,
            direction: r.direction,
            amount: r.amount,
            currency: chosen.currency,
            externalRef,
            ref: r.ref,
            docNumber: r.docNumber,
            purpose: r.purpose,
            counterparty: r.counterparty,
            counterpartyTaxId: r.counterpartyTaxId,
            counterpartyAccount: r.counterpartyAccount,
            ourAccount: r.ourAccount ?? statement.ourAccount,
            counterpartyAddress: null,
            network: null,
            fee: null,
            source: { file: p.name, line: r.line },
            status: 'new',
            existingId: null,
            attachTo: null,
            flags: [],
            suggestion: null,
          });
        }
        const dates = statement.rows.map((r) => r.occurredOn).sort();
        sources.push({
          file: p.name,
          sha256: p.sha256,
          accountId: chosen.id,
          ourAccount: statement.ourAccount,
          currency: statement.currency,
          from: dates[0] ?? null,
          to: dates.at(-1) ?? null,
          rows: statement.rows.length,
          skipped: statement.skipped,
          overlapping,
          columns: statement.columns,
          problems: statement.problems,
        });
      }
      if (!rows.length)
        return err(fileError('import.noRows', { file: parsed.map((p) => p.name).join(', ') }));
      if (rows.length > MAX_IMPORT_ROWS) {
        return err(fileError('import.tooManyRows', { max: String(MAX_IMPORT_ROWS) }));
      }

      const pairing = pairStatementRows(
        rows.map((r) => ({
          ...r,
          occurredOn: r.occurredOn as LocalDate,
          file: r.source.file,
          line: r.source.line,
        })),
      );
      const returned = new Set([...pairing.returnOf].flat());
      for (const r of rows) {
        if (returned.has(r.key)) r.status = 'returned';
        r.attachTo = pairing.counterOf.get(r.key) ?? pairing.feeOf.get(r.key) ?? null;
      }
      await checkAgainstLedger(tx, rows);
      for (const [credit, original] of pairing.returnOf) {
        const back = rows.find((r) => r.key === credit);
        const paid = rows.find((r) => r.key === original);
        // The rejected payment is in the Ledger already: its return has to be booked against it.
        if (back && paid && paid.status !== 'returned') {
          back.status = 'new';
          back.flags.push('returned_payment');
        }
      }
      for (const r of rows) {
        const target = r.attachTo ? rows.find((x) => x.key === r.attachTo) : undefined;
        if (target?.status !== 'returned') continue;
        // The bank keeps the fee of a rejected payment: a Bank Fees expense of its own.
        r.attachTo = null;
        r.flags.push('fee_of_returned');
      }
      await suggestFromLedger(tx, rows);
      const id = await insertDraft(tx, 'bank', sources, sortRows(rows));
      return ok({ id });
    });
  },
});
