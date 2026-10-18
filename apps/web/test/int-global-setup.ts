import { createDb } from '@tally/db';
import { ensureHouseCompany } from './house-company';

export default async function setup() {
  const { db, sql: client } = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await ensureHouseCompany(db);
  } finally {
    await client.end();
  }
}
