import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { clearMailbox, waitForMagicLink } from './mailpit';

export const E2E_VIEWER_EMAIL = 'viewer@tally.test';

/** Values from apps/web/.env.local (Playwright does not load Next.js env files). */
export function localEnv(): Record<string, string> {
  try {
    const text = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8');
    return Object.fromEntries(
      [...text.matchAll(/^([A-Z_]+)=(.*)$/gm)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]),
    );
  } catch {
    return {};
  }
}

/** Signs in through the real magic-link flow; the mailbox is cleared so no stale link is used. */
export async function signIn(page: Page, email: string) {
  await clearMailbox();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Надіслати посилання для входу' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.goto(await waitForMagicLink(email));
  await expect(page).toHaveURL(/\/dashboard$/);
}

export const unique = (label: string) => `${label} ${Date.now().toString(36)}`;
