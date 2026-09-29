import { describe, expect, it } from 'vitest';
import { decideSignIn } from './sign-in-policy';

const allowed = ['owner@syntora.tech', 'cofounder@syntora.tech'];

describe('decideSignIn', () => {
  it('bootstraps a whitelisted email without app_user as owner', () => {
    expect(decideSignIn(' Owner@Syntora.Tech ', allowed, null)).toEqual({
      kind: 'bootstrap_owner',
    });
  });

  it('denies an email outside the whitelist without app_user', () => {
    expect(decideSignIn('stranger@gmail.com', allowed, null)).toEqual({
      kind: 'deny',
      reason: 'not_whitelisted',
    });
  });

  it('allows an active app_user even when not whitelisted', () => {
    expect(
      decideSignIn('viewer@syntora.tech', allowed, { role: 'viewer', isActive: true }),
    ).toEqual({ kind: 'allow', role: 'viewer' });
  });

  it('denies a deactivated app_user even when whitelisted', () => {
    expect(decideSignIn('owner@syntora.tech', allowed, { role: 'owner', isActive: false })).toEqual(
      {
        kind: 'deny',
        reason: 'inactive',
      },
    );
  });

  it('denies everyone when the whitelist is empty and there are no users', () => {
    expect(decideSignIn('owner@syntora.tech', [], null).kind).toBe('deny');
  });
});
