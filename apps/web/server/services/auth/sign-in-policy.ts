import type { AppRole } from '@tally/db/schema';

export type ExistingAppUser = { role: AppRole; isActive: boolean } | null;

export type SignInDecision =
  | { kind: 'allow'; role: AppRole }
  | { kind: 'bootstrap_owner' }
  | { kind: 'deny'; reason: 'not_whitelisted' | 'inactive' };

/**
 * Access is governed by app_user; ALLOWED_EMAILS only bootstraps the first owners (spec 10.2, Q1).
 * A deactivated user stays out even if still whitelisted.
 */
export function decideSignIn(
  email: string,
  allowedEmails: readonly string[],
  existing: ExistingAppUser,
): SignInDecision {
  if (existing) {
    return existing.isActive
      ? { kind: 'allow', role: existing.role }
      : { kind: 'deny', reason: 'inactive' };
  }
  return allowedEmails.includes(normalizeEmail(email))
    ? { kind: 'bootstrap_owner' }
    : { kind: 'deny', reason: 'not_whitelisted' };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
