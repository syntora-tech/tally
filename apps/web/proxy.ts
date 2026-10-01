import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/public-env';

// /api/mcp authenticates its own bearer tokens.
const PUBLIC_PATHS = ['/login', '/auth/', '/api/cron/', '/api/mcp'];

/** Refreshes the Supabase session cookie and sends anonymous visitors to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Must run right after client creation: it refreshes an expired session.
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
