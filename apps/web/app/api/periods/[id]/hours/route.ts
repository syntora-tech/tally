import { toCsv } from '@tally/domain';
import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/server/request-context';
import { getPeriodOverview } from '@/server/services/periods';
import { FINANCE_ROLES } from '@/lib/navigation';

/** Hours template for the period: fill hours (and the project note) and upload it back (6.4 step 2). */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/periods/[id]/hours'>) {
  const serviceCtx = await requireRole(FINANCE_ROLES);
  const { id } = await ctx.params;
  const result = await getPeriodOverview.run(serviceCtx, { periodId: id });
  if (result.isErr()) return NextResponse.json({ error: result.error.message }, { status: 404 });
  const csv = toCsv(
    [
      { header: 'assignment_id', value: (a) => a.assignmentId },
      { header: 'person', value: (a) => a.personName },
      { header: 'client', value: (a) => a.clientName ?? 'internal' },
      { header: 'role', value: (a) => a.roleTitle },
      { header: 'hours', value: (a) => a.hours },
      { header: 'note', value: (a) => a.note ?? null },
    ],
    result.value.assignments,
  );
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="hours-${result.value.period.month.slice(0, 7)}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
