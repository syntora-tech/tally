import { NextResponse, type NextRequest } from 'next/server';
import { FINANCE_ROLES } from '@/lib/navigation';
import { localizeForUser } from '@/server/i18n';
import { invoicePreviewRenderer } from '@/server/jobs';
import { invoiceFileName, invoiceLayout, invoiceTemplate } from '@/server/jobs/render-invoice';
import { requireRole } from '@/server/request-context';
import { invoiceDraftPreview } from '@/server/services/invoices';

/** The draft as issuing it on `?date=` would print it (6.5); rendered on the fly, never filed. */
export async function GET(request: NextRequest, route: RouteContext<'/api/invoices/[id]/preview'>) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await route.params;
  const result = await invoiceDraftPreview.run(ctx, {
    id,
    issueDate: request.nextUrl.searchParams.get('date') ?? undefined,
  });
  if (result.isErr()) {
    const error = await localizeForUser(result.error);
    return new NextResponse(error.message, {
      status: error.code === 'not_found' ? 404 : 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const draft = result.value;
  const layout = invoiceLayout(draft.quantities);
  const { renderer, templates } = invoicePreviewRenderer();
  try {
    const file = await renderer.preview({
      layout,
      templateId: draft.templateId ?? invoiceTemplate(templates, layout),
      fileName: `${invoiceFileName(draft.number, draft.clientName, draft.issueDate)} (preview)`,
      snapshot: draft.snapshot,
    });
    return new NextResponse(Buffer.from(file.data), {
      headers: {
        'content-type': file.mimeType,
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Invoice preview failed', error);
    return new NextResponse(error instanceof Error ? error.message : 'Preview failed', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
