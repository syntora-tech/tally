import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: '../../supabase/migrations',
  migrations: { prefix: 'supabase' },
  schemaFilter: ['public'],
  entities: { roles: { provider: 'supabase' } },
  dbCredentials: {
    url:
      process.env.DIRECT_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
