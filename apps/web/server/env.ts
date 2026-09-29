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
  CRON_SECRET: z.string().min(16).optional(),
  APP_TODAY: optionalLocalDate,
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Parsed lazily so `next build` does not need runtime secrets. */
export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
