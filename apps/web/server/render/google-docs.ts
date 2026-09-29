import type { docs_v1 } from '@googleapis/docs';
import { err, ok, type Result } from 'neverthrow';
import {
  fillText,
  isLinePlaceholder,
  placeholdersIn,
  validateTemplate,
  type TemplateData,
  type TemplateError,
} from './template';

type Element = docs_v1.Schema$StructuralElement;
type Request = docs_v1.Schema$Request;

function paragraphText(p: docs_v1.Schema$Paragraph | undefined): string {
  return (p?.elements ?? []).map((e) => e.textRun?.content ?? '').join('');
}

/** Text of a cell without the final paragraph mark, which Docs never lets us delete. */
function cellText(cell: docs_v1.Schema$TableCell): string {
  return (cell.content ?? [])
    .map((e) => paragraphText(e.paragraph))
    .join('')
    .replace(/\n$/, '');
}

function cellRange(cell: docs_v1.Schema$TableCell): { start: number; end: number } {
  const content = cell.content ?? [];
  const start = content[0]?.startIndex ?? 0;
  const end = (content.at(-1)?.endIndex ?? start + 1) - 1;
  return { start, end };
}

function allText(content: Element[] | undefined, skip?: docs_v1.Schema$TableRow): string {
  return (content ?? [])
    .map((e) => {
      if (e.paragraph) return paragraphText(e.paragraph);
      if (e.table)
        return (e.table.tableRows ?? [])
          .filter((r) => r !== skip)
          .flatMap((r) => (r.tableCells ?? []).map((c) => allText(c.content)))
          .join('');
      return '';
    })
    .join('');
}

export type LineRow = { tableStart: number; rowIndex: number; row: docs_v1.Schema$TableRow };

/** The table row whose cells hold `{{line.*}}` placeholders (7.2); at most one per template. */
export function findLineRow(body: docs_v1.Schema$Body | undefined): LineRow | null {
  for (const el of body?.content ?? []) {
    const rows = el.table?.tableRows ?? [];
    const rowIndex = rows.findIndex((r) =>
      (r.tableCells ?? []).some((c) => placeholdersIn(cellText(c)).some(isLinePlaceholder)),
    );
    const row = rows[rowIndex];
    if (row && el.startIndex != null) return { tableStart: el.startIndex, rowIndex, row };
  }
  return null;
}

export type TemplatePlan = { lineRow: LineRow | null; cellTemplates: string[]; globals: string[] };

export function planTemplate(
  doc: docs_v1.Schema$Document,
  data: TemplateData,
): Result<TemplatePlan, TemplateError> {
  const lineRow = findLineRow(doc.body);
  const cellTemplates = (lineRow?.row.tableCells ?? []).map(cellText);
  const globalText = allText(doc.body?.content, lineRow?.row);
  const valid = validateTemplate(data, globalText, cellTemplates.join('\n'));
  if (valid.isErr()) return err(valid.error);
  return ok({ lineRow, cellTemplates, globals: placeholdersIn(globalText) });
}

/** Step 1: N−1 empty copies of the line row, inserted below it. */
export function insertRowRequests(plan: TemplatePlan, lineCount: number): Request[] {
  if (!plan.lineRow || lineCount < 2) return [];
  const { tableStart, rowIndex } = plan.lineRow;
  return Array.from({ length: lineCount - 1 }, () => ({
    insertTableRow: {
      tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex, columnIndex: 0 },
      insertBelow: true,
    },
  }));
}

/**
 * Step 2 (on the re-fetched document): fills the line rows bottom-up and right-to-left so earlier
 * indices stay valid, then replaces the global placeholders everywhere.
 */
export function fillRequests(
  doc: docs_v1.Schema$Document,
  plan: TemplatePlan,
  data: TemplateData,
): Request[] {
  const requests: Request[] = [];
  const lines = data.lines ?? [];
  if (plan.lineRow) {
    const table = (doc.body?.content ?? []).find(
      (e) => e.startIndex === plan.lineRow?.tableStart && e.table,
    )?.table;
    const rows = table?.tableRows ?? [];
    const count = Math.max(lines.length, 1);
    for (let k = count - 1; k >= 0; k--) {
      const cells = rows[plan.lineRow.rowIndex + k]?.tableCells ?? [];
      for (let c = cells.length - 1; c >= 0; c--) {
        const cell = cells[c];
        if (!cell) continue;
        const { start, end } = cellRange(cell);
        const text = lines[k] ? fillText(plan.cellTemplates[c] ?? '', data, lines[k]) : '';
        if (end > start)
          requests.push({ deleteContentRange: { range: { startIndex: start, endIndex: end } } });
        if (text) requests.push({ insertText: { location: { index: start }, text } });
      }
    }
  }
  for (const path of plan.globals) {
    requests.push({
      replaceAllText: {
        containsText: { text: `{{${path}}}`, matchCase: true },
        replaceText: fillText(`{{${path}}}`, data),
      },
    });
  }
  return requests;
}
