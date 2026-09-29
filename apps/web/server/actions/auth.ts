'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { anonymousContext } from '../request-context';
import { checkSignInAllowed } from '../services/auth';
import { serviceError } from '../services/errors';
import { createSupabaseServerClient } from '../supabase/server-client';
import type { ActionResult } from './to-action-result';

export type MagicLinkState = ActionResult<{ sent: true }> | null;

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function callbackUrl(origin: string, next: FormDataEntryValue | null): string {
  const url = new URL('/auth/callback', origin);
  if (typeof next === 'string' && next) url.searchParams.set('next', next);
  return url.toString();
}

export async function requestMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const checked = await checkSignInAllowed.run(anonymousContext(), {
    email: formData.get('email'),
  });
  if (checked.isErr()) return { ok: false, error: checked.error };

  // Same response for unknown emails, so the form does not reveal who has access.
  if (checked.value.allowed) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: checked.value.email,
      options: {
        emailRedirectTo: callbackUrl(await requestOrigin(), formData.get('next')),
        shouldCreateUser: true,
      },
    });
    if (error) {
      return {
        ok: false,
        error: serviceError('internal_error', 'Не вдалося надіслати лист. Спробуйте пізніше'),
      };
    }
  }
  return { ok: true, data: { sent: true } };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl(await requestOrigin(), formData.get('next')) },
  });
  if (error) redirect('/login?error=auth');
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
