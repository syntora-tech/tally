import type { ServiceContext } from '@/server/services/context';
import { listClients } from '@/server/services/clients';
import { listAccounts, listCategories } from '@/server/services/ledger';
import { searchPeople } from '@/server/services/people';

/** Options shared by the new and edit pages; an edited transaction may use an archived account. */
export async function transactionFormData(ctx: ServiceContext, includeInactive = false) {
  const [accounts, categories, people, clients] = await Promise.all([
    listAccounts.run(ctx, { includeInactive }),
    listCategories.run(ctx, {}),
    searchPeople.run(ctx, {}),
    listClients.run(ctx, {}),
  ]);
  return {
    accounts: accounts.unwrapOr([]).map(({ account: a }) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      kind: a.kind,
    })),
    categories: categories.unwrapOr([]).map((c) => ({ id: c.id, txType: c.txType, name: c.name })),
    people: people.unwrapOr([]).map((p) => ({ id: p.id, name: p.fullName })),
    clients: clients.unwrapOr([]).map((c) => ({ id: c.id, name: c.shortName ?? c.legalName })),
  };
}
