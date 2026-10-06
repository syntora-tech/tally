import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DossierView, isEmptyShelf, ShelfView } from '@/components/dossier-view';
import { Button } from '@/components/ui/button';
import type { ServiceContext } from '@/server/services/context';
import { documentTree } from '@/server/services/documents/structure';
import { DocumentsNav } from './documents-nav';

/**
 * The registry as a tree (A-081): each client and payee opens into its contracts, SOWs and
 * documents by month; each document opens into the records it is linked to.
 */
export async function DocumentsTreeView({
  ctx,
  canWrite,
}: {
  ctx: ServiceContext;
  canWrite: boolean;
}) {
  const result = await documentTree.run(ctx, {});
  const [t, td] = await Promise.all([getTranslations('documents'), getTranslations('docTree')]);
  const tree = result.isOk() ? result.value : { parties: [], other: null, otherCount: 0 };
  const href = (kind: 'client' | 'payee', id: string) =>
    kind === 'client' ? `/clients/${id}` : `/people/payees/${id}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{td('subtitle')}</p>
        </div>
        {canWrite && <Button render={<Link href="/documents/new" />}>{t('add')}</Button>}
      </div>
      <DocumentsNav current="structure" finance={canWrite} />

      {(['client', 'payee'] as const).map((kind) => {
        const parties = tree.parties.filter((p) => p.kind === kind);
        if (!parties.length) return null;
        return (
          <section key={kind} className="flex flex-col gap-2" aria-label={td(kind)}>
            <h2 className="text-lg font-semibold">{td(kind)}</h2>
            {parties.map((p) => (
              <details key={p.id} className="rounded-md border p-3" data-testid="tree-party">
                <summary className="cursor-pointer font-medium">
                  {p.name}
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {td('count', { count: p.count })}
                  </span>{' '}
                  <Link
                    href={href(p.kind, p.id)}
                    className="text-xs font-normal text-muted-foreground hover:underline"
                  >
                    {td('openCard')}
                  </Link>
                </summary>
                <div className="mt-3">
                  <DossierView dossier={p.dossier} />
                </div>
              </details>
            ))}
          </section>
        );
      })}

      {tree.other && !isEmptyShelf(tree.other) && (
        <section className="flex flex-col gap-2" aria-label={td('other')}>
          <h2 className="text-lg font-semibold">{td('other')}</h2>
          <details className="rounded-md border p-3" data-testid="tree-other">
            <summary className="cursor-pointer font-medium">
              {td('otherHint')}
              <span className="font-normal text-muted-foreground">
                {' '}
                · {td('count', { count: tree.otherCount })}
              </span>
            </summary>
            <div className="mt-3 text-sm">
              <ShelfView shelf={tree.other} />
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
