// Creates apps/web/.env.local from .env.example with keys of the running local Supabase stack.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/web/.env.local');
const force = process.argv.includes('--force');

if (existsSync(target) && !force) {
  console.log(`${target} already exists; pass --force to overwrite.`);
  process.exit(0);
}

const status = execFileSync(join(root, 'scripts/supabase.sh'), ['status', '-o', 'env'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const stack = Object.fromEntries(
  [...status.matchAll(/^([A-Z_]+)="?(.*?)"?$/gm)].map((m) => [m[1], m[2]]),
);
for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL']) {
  if (!stack[key]) throw new Error(`Missing ${key} in \`supabase status\`; is the stack running?`);
}

const values = {
  DATABASE_URL: stack.DB_URL,
  DIRECT_DATABASE_URL: stack.DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
};

const env = readFileSync(join(root, '.env.example'), 'utf8').replace(
  /^([A-Z_]+)=.*$/gm,
  (line, key) => (key in values ? `${key}=${values[key]}` : line),
);
writeFileSync(target, env);
console.log(`Wrote ${target}. Set ALLOWED_EMAILS to your email before signing in.`);
