import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/server/cron/verify-secret';
import { getServerEnv } from '@/server/env';
import { runJobsOnce } from '@/server/jobs';

// Handlers are registered by the stages that introduce them (nbu-rates, payability, tmp-cleanup).
const HANDLERS: Record<string, () => Promise<unknown>> = { jobs: runJobsOnce };

export async function POST(request: NextRequest, ctx: RouteContext<'/api/cron/[name]'>) {
  if (!verifyCronSecret(request.headers.get('authorization'), getServerEnv().CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name } = await ctx.params;
  const handler = HANDLERS[name];
  if (!handler) return NextResponse.json({ error: 'unknown_job' }, { status: 404 });
  return NextResponse.json({ ok: true, result: await handler() });
}
