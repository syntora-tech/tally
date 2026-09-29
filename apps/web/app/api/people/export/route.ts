import { NextResponse, type NextRequest } from 'next/server';
import { requireUserContext } from '@/server/request-context';
import { searchPeople } from '@/server/services/people';
import { benchCsv } from '@/server/services/people/export';

/** CSV of the currently filtered Bench list (same query params as /people). */
export async function GET(request: NextRequest) {
  const ctx = await requireUserContext();
  const filters = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await searchPeople.run(ctx, filters);
  if (result.isErr()) {
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }
  return new NextResponse(benchCsv(result.value, ctx.today), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="syntora-bench-${ctx.today}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
