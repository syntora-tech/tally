import type { Db } from '@tally/db';
import { sql } from 'drizzle-orm';

/**
 * Acts are issued for the first company and refuse one without requisites, so test runs make sure
 * it exists and fill only what is empty.
 */
export async function ensureHouseCompany(db: Db) {
  await db.execute(sql`
    insert into public.company (name_en, name_ua)
    select 'LLC "SYNTORA"', 'ТОВ «СІНТОРА»'
     where not exists (select 1 from public.company)`);
  await db.execute(sql`
    update public.company
       set legal_code = coalesce(legal_code, '00000000'),
           address_ua = coalesce(address_ua, 'м. Київ'),
           director_ua = coalesce(director_ua, 'Директор'),
           bank_details_ua = coalesce(bank_details_ua, 'UA000000000000000000000000000')
     where id = (select id from public.company order by created_at limit 1)`);
}
