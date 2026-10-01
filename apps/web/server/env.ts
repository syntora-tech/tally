import 'server-only';
import { parseLocalDate, type LocalDate } from '@tally/domain';
import { z } from 'zod';

const emailList = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );

const optionalLocalDate = z
  .string()
  .optional()
  .transform((raw, ctx): LocalDate | undefined => {
    if (!raw) return undefined;
    const parsed = parseLocalDate(raw);
    if (parsed.isErr()) {
      ctx.addIssue({ code: 'custom', message: 'APP_TODAY must be YYYY-MM-DD' });
      return z.NEVER;
    }
    return parsed.value;
  });

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ALLOWED_EMAILS: emailList,
  STORAGE_DRIVER: z.enum(['drive', 'local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.storage'),
  GOOGLE_SA_EMAIL: z.string().optional(),
  // Vercel/.env store the PEM on one line with literal \n.
  GOOGLE_SA_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((key) => key?.replaceAll('\\n', '\n')),
  GOOGLE_DRIVE_ROOT_ID: z.string().optional(),
  GOOGLE_TEMPLATE_INVOICE_HOURLY_ID: z.string().optional(),
  GOOGLE_TEMPLATE_INVOICE_FIXED_ID: z.string().optional(),
  GOOGLE_TEMPLATE_ACT_FOP_ID: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  APP_TODAY: optionalLocalDate,
  /** E2E only: lets a `tally_today` cookie move the business date per request (never in production). */
  ALLOW_TODAY_OVERRIDE: z.enum(['0', '1']).optional(),
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type DriveConfig = { email: string; privateKey: string; rootId: string };

/** Drive settings, or an error naming what is missing when STORAGE_DRIVER=drive. */
export function driveConfig(env: ServerEnv): DriveConfig {
  const {
    GOOGLE_SA_EMAIL: email,
    GOOGLE_SA_PRIVATE_KEY: privateKey,
    GOOGLE_DRIVE_ROOT_ID: rootId,
  } = env;
  if (!email || !privateKey || !rootId) {
    throw new Error(
      'STORAGE_DRIVER=drive requires GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY and GOOGLE_DRIVE_ROOT_ID',
    );
  }
  return { email, privateKey, rootId };
}

let cached: ServerEnv | undefined;

/** Parsed lazily so `next build` does not need runtime secrets. */
export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
