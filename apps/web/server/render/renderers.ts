import type { docs_v1 } from '@googleapis/docs';
import type { drive_v3 } from '@googleapis/drive';
import type { InvoiceSnapshot } from '../services/invoices/snapshot';
import type { DriveStorage } from '../storage/drive-storage';
import { safeFileName } from '../storage/folders';
import { fillRequests, insertRowRequests, planTemplate } from './google-docs';
import { describeTemplateError } from './template';

export type InvoiceLayout = 'invoice_hourly' | 'invoice_fixed';

export type RenderInput = {
  layout: InvoiceLayout;
  /** Google Docs template id: the contract's own, else the default for the layout. */
  templateId: string | null;
  folderPath: string;
  fileName: string;
  snapshot: InvoiceSnapshot;
};

export type RenderOutput = {
  /** Editable source kept next to the PDF (the Google Doc copy); null for local renders. */
  sourceFileId: string | null;
  file: { data: Uint8Array; mimeType: string; fileName: string };
};

export interface DocumentRenderer {
  render(input: RenderInput): Promise<RenderOutput>;
}

/** Spec 7.1: copy the template, fill it through batchUpdate, export to PDF. */
export class GoogleDocsRenderer implements DocumentRenderer {
  constructor(
    private readonly files: Pick<drive_v3.Resource$Files, 'copy' | 'export'>,
    private readonly documents: Pick<docs_v1.Resource$Documents, 'get' | 'batchUpdate'>,
    private readonly storage: DriveStorage,
  ) {}

  async render({ templateId, folderPath, fileName, snapshot }: RenderInput): Promise<RenderOutput> {
    if (!templateId) throw new Error('No Google Docs template configured for this invoice layout');
    const parent = await this.storage.ensureFolder(folderPath);
    const copy = await this.files.copy({
      fileId: templateId,
      supportsAllDrives: true,
      requestBody: { name: safeFileName(fileName), parents: [parent] },
      fields: 'id',
    });
    const documentId = copy.data.id;
    if (!documentId) throw new Error('Drive did not return an id for the template copy');

    const original = (await this.documents.get({ documentId })).data;
    const plan = planTemplate(original, snapshot);
    if (plan.isErr()) throw new Error(describeTemplateError(plan.error));

    const insert = insertRowRequests(plan.value, snapshot.lines.length);
    if (insert.length) {
      await this.documents.batchUpdate({ documentId, requestBody: { requests: insert } });
    }
    const expanded = insert.length ? (await this.documents.get({ documentId })).data : original;
    const fill = fillRequests(expanded, plan.value, snapshot);
    if (fill.length) {
      await this.documents.batchUpdate({ documentId, requestBody: { requests: fill } });
    }

    const pdf = await this.files.export(
      { fileId: documentId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' },
    );
    return {
      sourceFileId: documentId,
      file: {
        data: new Uint8Array(pdf.data as ArrayBuffer),
        mimeType: 'application/pdf',
        fileName: `${fileName}.pdf`,
      },
    };
  }
}

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * Local development without Google access (A-045): a printable bilingual HTML page from the same
 * snapshot, so the issue → file → document flow is exercised end to end.
 */
export class HtmlRenderer implements DocumentRenderer {
  render({ layout, fileName, snapshot: s }: RenderInput): Promise<RenderOutput> {
    const e = escapeHtml;
    const hourly = layout === 'invoice_hourly';
    const rows = s.lines
      .map(
        (l) =>
          `<tr><td>${e(l.n)}</td><td>${e(l.description_en)}<br><small>${e(l.description_ua)}</small></td>` +
          (hourly ? `<td>${e(l.qty)}</td><td>${e(l.price)}</td>` : '') +
          `<td>${e(l.amount)}</td></tr>`,
      )
      .join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(fileName)}</title>
<style>body{font:14px/1.4 sans-serif;max-width:800px;margin:2rem auto}table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:4px;text-align:left}.draft{color:#b00}</style></head><body>
<p class="draft">Local render (no Google template)</p>
<h1>Invoice / Рахунок № ${e(s.doc.number)}</h1>
<p>${e(s.doc.place_en)}, ${e(s.doc.date)} · ${e(s.doc.place_ua)}, ${e(s.doc.date_ua)}</p>
<p><b>${e(s.company.name_en)}</b> / ${e(s.company.name_ua)}<br>${e(s.company.address_en)}<br>${e(s.company.bank_en)}</p>
<p>Bill to: <b>${e(s.client.name)}</b><br>${e(s.client.address)}</p>
<p>${e(s.contract.title_en)}${s.contract.date ? ` dated ${e(s.contract.date)}` : ''}${s.period.text_ua ? ` · Період: ${e(s.period.text_ua)}` : ''}</p>
<table><thead><tr><th>№</th><th>Description / Опис</th>${hourly ? '<th>Qty</th><th>Price</th>' : ''}<th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<p><b>Total: ${e(s.total.amount)} ${e(s.total.currency)}</b><br>${e(s.total.words_en)}<br>${e(s.total.words_ua)}</p>
<p>Due date / Оплатити до: ${e(s.doc.due_date)}</p>
</body></html>`;
    return Promise.resolve({
      sourceFileId: null,
      file: {
        data: new TextEncoder().encode(html),
        mimeType: 'text/html',
        fileName: `${fileName}.html`,
      },
    });
  }
}
