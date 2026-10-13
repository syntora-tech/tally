import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@tally/domain';
import { contractorInvoiceNumber } from '.';

const day = '2026-10-13' as LocalDate;

describe('contractor invoice number', () => {
  it('is the invoice date as DDMMYYYY, with /n once that one is taken', () => {
    expect(contractorInvoiceNumber(day, [])).toBe('13102026');
    expect(contractorInvoiceNumber(day, ['13102026'])).toBe('13102026/1');
    expect(contractorInvoiceNumber(day, ['13102026', '13102026/1'])).toBe('13102026/2');
  });
});
