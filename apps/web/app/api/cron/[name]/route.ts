import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/server/cron/verify-secret';
import { getServerEnv } from '@/server/env';
import { getDb } from '@/server/db/client';
import { runJobsOnce } from '@/server/jobs';
import { syncNbuRates } from '@/server/services/fx';
import { refreshPayability } from '@/server/services/payroll/payability';
import { getToday } from '@/server/today';

// Handlers are registered by the stages that introduce them (tmp-cleanup comes later).
const HANDLERS: Record<string, () => Promise<unknown>> = {
  jobs: runJobsOnce,
  'nbu-rates': () => syncNbuRates(getDb(), getToday()),
  payability: () => refreshPayability(getDb(), getToday()),
};

export async function POST(request: NextRequest, ctx: RouteContext<'/api/cron/[name]'>) {
  if (!verifyCronSecret(request.headers.get('authorization'), getServerEnv().CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name } = await ctx.params;
  const handler = HANDLERS[name];
  if (!handler) return NextResponse.json({ error: 'unknown_job' }, { status: 404 });
  return NextResponse.json({ ok: true, result: await handler() });
}
