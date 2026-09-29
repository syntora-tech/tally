import { NextResponse, type NextRequest } from 'next/server';
import type { JwtClaims } from '@/server/db/with-user';
import { anonymousContext } from '@/server/request-context';
import { completeSignIn } from '@/server/services/auth';
import { createSupabaseServerClient } from '@/server/supabase/server-client';

/** Only same-origin relative paths; blocks open redirects like `//evil.com`. */
function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const toLogin = (error: string) =>
    NextResponse.redirect(new URL(`/login?error=${error}`, request.url));

  const code = searchParams.get('code');
  if (!code) return toLogin('auth');

  const supabase = await createSupabaseServerClient();
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) return toLogin('auth');

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as JwtClaims | undefined;
  if (!claims) return toLogin('auth');

  const result = await completeSignIn.run(anonymousContext(), {
    userId: claims.sub,
    email: claims.email,
  });
  if (result.isErr()) {
    await supabase.auth.signOut();
    return toLogin('forbidden');
  }

  return NextResponse.redirect(new URL(safeNext(searchParams.get('next')), request.url));
}
