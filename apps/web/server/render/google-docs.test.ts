import type { docs_v1 } from '@googleapis/docs';
import { describe, expect, it } from 'vitest';
import { fillRequests, insertRowRequests, planTemplate } from './google-docs';
import { fillText, validateTemplate } from './template';

const data = {
  doc: { number: '25/26', date: '01.10.2026' },
  total: { amount: '100.00' },
  lines: [
    { n: '1', description_en: 'Dev A', qty: '10.00' },
    { n: '2', description_en: 'Dev B', qty: '20.00' },
  ],
};

const para = (text: string, start: number): docs_v1.Schema$StructuralElement => ({
  startIndex: start,
  endIndex: start + text.length,
  paragraph: { elements: [{ textRun: { content: text } }] },
});

const cell = (text: string, start: number): docs_v1.Schema$TableCell => ({
  content: [para(`${text}\n`, start)],
});

/** Header paragraph, then a table: a header row and the `{{line.*}}` row. */
function templateDoc(): docs_v1.Schema$Document {
  return {
    body: {
      content: [
        para('Invoice {{doc.number}} of {{doc.date}}\n', 1),
        {
          startIndex: 40,
          table: {
            tableRows: [
              { tableCells: [cell('No', 42), cell('Description', 46)] },
              { tableCells: [cell('{{line.n}}', 60), cell('{{line.description_en}}', 72)] },
            ],
          },
        },
        para('Total {{total.amount}}\n', 100),
      ],
    },
  };
}

describe('template placeholders (7.2)', () => {
  it('fills globals and line values', () => {
    expect(fillText('No {{doc.number}}: {{line.qty}}', data, data.lines[1])).toBe(
      'No 25/26: 20.00',
    );
  });

  it('rejects unknown placeholders and line placeholders outside the table', () => {
    expect(validateTemplate(data, '{{doc.numbr}}', '')._unsafeUnwrapErr()).toEqual({
      code: 'unknown_placeholder',
      placeholders: ['doc.numbr'],
    });
    expect(validateTemplate(data, '{{line.n}}', '')._unsafeUnwrapErr().code).toBe(
      'line_outside_table',
    );
  });
});

describe('Google Docs request planning', () => {
  it('finds the line row and inserts N-1 rows below it', () => {
    const plan = planTemplate(templateDoc(), data)._unsafeUnwrap();
    expect(plan.lineRow?.rowIndex).toBe(1);
    expect(plan.cellTemplates).toEqual(['{{line.n}}', '{{line.description_en}}']);
    expect(plan.globals).toEqual(['doc.number', 'doc.date', 'total.amount']);
    expect(insertRowRequests(plan, 2)).toEqual([
      {
        insertTableRow: {
          tableCellLocation: { tableStartLocation: { index: 40 }, rowIndex: 1, columnIndex: 0 },
          insertBelow: true,
        },
      },
    ]);
  });

  it('fills rows bottom-up, right-to-left, then replaces globals', () => {
    const plan = planTemplate(templateDoc(), data)._unsafeUnwrap();
    const expanded = templateDoc();
    const rows = expanded.body?.content?.[1]?.table?.tableRows ?? [];
    rows.push({ tableCells: [cell('', 96), cell('', 98)] });

    const requests = fillRequests(expanded, plan, data);
    expect(requests.slice(0, 6)).toEqual([
      { insertText: { location: { index: 98 }, text: 'Dev B' } },
      { insertText: { location: { index: 96 }, text: '2' } },
      { deleteContentRange: { range: { startIndex: 72, endIndex: 95 } } },
      { insertText: { location: { index: 72 }, text: 'Dev A' } },
      { deleteContentRange: { range: { startIndex: 60, endIndex: 70 } } },
      { insertText: { location: { index: 60 }, text: '1' } },
    ]);
    expect(requests.at(-1)).toEqual({
      replaceAllText: {
        containsText: { text: '{{total.amount}}', matchCase: true },
        replaceText: '100.00',
      },
    });
  });

  it('fails the render on an unknown placeholder', () => {
    const doc = templateDoc();
    doc.body?.content?.push(para('{{client.vat}}\n', 130));
    expect(planTemplate(doc, data)._unsafeUnwrapErr()).toEqual({
      code: 'unknown_placeholder',
      placeholders: ['client.vat'],
    });
  });
});
