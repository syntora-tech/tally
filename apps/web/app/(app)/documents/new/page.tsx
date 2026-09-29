import { LINK_ENTITY_TYPES, type LinkEntityType } from '@tally/db/schema';
import type { Metadata } from 'next';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { linkTargets } from '@/server/services/documents/registry';
import { DocumentForm } from '../document-form';

export const metadata: Metadata = { title: 'Новий документ · Tally' };

const BACK: Partial<Record<LinkEntityType, (id: string) => string>> = {
  person: (id) => `/people/${id}`,
  client: (id) => `/clients/${id}`,
  payee: (id) => `/people/payees/${id}`,
  contract: (id) => `/clients/contracts/${id}`,
  assignment: (id) => `/people/assignments/${id}`,
};

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; entityId?: string; type?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { entityType, entityId, type } = await searchParams;
  const targets = (await linkTargets.run(ctx, {}))._unsafeUnwrap();
  const validEntity =
    entityType && entityId && (LINK_ENTITY_TYPES as readonly string[]).includes(entityType)
      ? { type: entityType as LinkEntityType, id: entityId }
      : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Новий документ</h1>
      <DocumentForm
        targets={targets}
        initialLinks={validEntity ? [`${validEntity.type}:${validEntity.id}`] : []}
        {...(type ? { initialType: type } : {})}
        cancelHref={
          validEntity ? (BACK[validEntity.type]?.(validEntity.id) ?? '/documents') : '/documents'
        }
      />
    </div>
  );
}
