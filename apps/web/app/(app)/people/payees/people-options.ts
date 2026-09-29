import type { ServiceContext } from '@/server/services/context';
import { searchPeople } from '@/server/services/people';

export async function peopleOptions(ctx: ServiceContext) {
  const result = await searchPeople.run(ctx, {});
  return result.isOk() ? result.value.map((p) => ({ value: p.id, label: p.fullName })) : [];
}
