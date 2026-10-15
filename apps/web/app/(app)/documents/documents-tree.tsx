import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DossierView, isEmptyShelf, ShelfView } from '@/components/dossier-view';
import { Button } from '@/components/ui/button';
import type { ServiceContext } from '@/server/services/context';
import { documentTree } from '@/server/services/documents/structure';
import { DocumentsHeaderV2, DocumentsNav } from './documents-nav';
import { getUiPrefs } from '@/server/ui-prefs';
import { Panel } from '@/components/v2/panel';

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

  const v2 = (await getUiPrefs()).version === 'v2';
  if (v2) {
    const row = (
      key: string,
      testId: string,
      summary: React.ReactNode,
      body: React.ReactNode,
      link?: string,
    ) => (
      <details key={key} className="group border-t first:border-t-0" data-testid={testId}>
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 hover:bg-muted/40">
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          {link && (
            <Link href={link} className="shrink-0 text-xs text-link hover:underline">
              {td('openCard')}
            </Link>
          )}
        </summary>
        <div className="px-5 pt-1 pb-4 sm:pl-10">{body}</div>
      </details>
    );
    return (
      <div className="flex flex-col gap-5">
        <DocumentsHeaderV2 current="structure" help={td('subtitle')} finance={canWrite} />
        {(['client', 'payee'] as const).map((kind) => {
          const parties = tree.parties.filter((p) => p.kind === kind);
          if (!parties.length) return null;
          return (
            <Panel key={kind} title={td(kind)} flush>
              <div>
                {parties.map((p) =>
                  row(
                    p.id,
                    'tree-party',
                    <>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {td('count', { count: p.count })}
                      </span>
                    </>,
                    <DossierView dossier={p.dossier} />,
                    href(p.kind, p.id),
                  ),
                )}
              </div>
            </Panel>
          );
        })}
        {tree.other && !isEmptyShelf(tree.other) && (
          <Panel title={td('other')} flush>
            <div>
              {row(
                'other',
                'tree-other',
                <>
                  <span className="font-medium">{td('otherHint')}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {td('count', { count: tree.otherCount })}
                  </span>
                </>,
                <div className="text-sm">
                  <ShelfView shelf={tree.other} />
                </div>,
              )}
            </div>
          </Panel>
        )}
      </div>
    );
  }
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
