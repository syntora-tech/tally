import { NextResponse, type NextRequest } from 'next/server';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { actsRegistry, actsRegistrySheet } from '@/server/services/acts/registry';
import { writeXlsx } from '@/server/xlsx';

/** The supplier acts registry as .xlsx (same query params as /acts, A-087). */
export async function GET(request: NextRequest) {
  const ctx = await requireRole(FINANCE_ROLES);
  const filters = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await actsRegistry.run(ctx, { ...filters, all: false });
  if (result.isErr()) {
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }
  const suffix = filters.year || ctx.today;
  return new NextResponse(new Uint8Array(writeXlsx(actsRegistrySheet(result.value.groups))), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="syntora-supplier-acts-${suffix}.xlsx"`,
      'cache-control': 'private, no-store',
    },
  });
}
