import type { DocumentType, LinkEntityType } from '@tally/db/schema';
import { ExternalLink, FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getTranslations } from 'next-intl/server';
import { getFormat, getLabels } from '@/server/i18n';
import type { ServiceContext } from '@/server/services/context';
import { documentsForEntity } from '@/server/services/documents/read';
import { getUiPrefs } from '@/server/ui-prefs';
import { Panel } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';

type Props = {
  ctx: ServiceContext;
  entityType: LinkEntityType;
  entityId: string;
  /** Shows "Add" leading to the document form with this entity pre-linked. */
  canAdd?: boolean;
  /** Extra action, e.g. the CV upload on a person card. */
  action?: React.ReactNode;
  /** v2: rows shown above the linked documents, e.g. an invoice's own PDF and signed copy. */
  leading?: React.ReactNode;
};

export function documentHref(doc: { id: string; hasFile: boolean; url: string | null }) {
  return doc.hasFile ? `/api/files/${doc.id}` : doc.url;
}

/** Documents attached to an entity; every card shows them (spec 6). */
export async function LinkedDocuments({
  ctx,
  entityType,
  entityId,
  canAdd,
  action,
  leading,
}: Props) {
  const result = await documentsForEntity.run(ctx, { entityType, entityId });
  const docs = result.isOk() ? result.value : [];
  const [t, tc, fmt, { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS }] = await Promise.all([
    getTranslations('linkedDocs'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);

  if ((await getUiPrefs()).version === 'v2') {
    return (
      <Panel
        title={t('title')}
        action={
          <>
            {action}
            {canAdd && (
              <Button
                size="sm"
                variant="outline"
                render={
                  <Link href={`/documents/new?entityType=${entityType}&entityId=${entityId}`} />
                }
              >
                <Plus className="size-4" /> {tc('add')}
              </Button>
            )}
          </>
        }
      >
        {leading}
        {docs.length === 0 ? (
          leading ? null : (
            <p className="text-muted-foreground">{t('empty')}</p>
          )
        ) : (
          <ul className="-mx-5 flex flex-col divide-y border-t">
            {docs.map((doc) => {
              const fileHref = documentHref(doc);
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
                >
                  {doc.hasFile ? (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <Link
                    href={`/documents/${doc.id}`}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  >
                    {doc.title}
                  </Link>
                  <Status>{DOCUMENT_TYPE_LABELS[doc.type as DocumentType]}</Status>
                  {doc.version > 1 && <Status>v{doc.version}</Status>}
                  {doc.status !== 'issued' && <Status>{DOC_STATUS_LABELS[doc.status]}</Status>}
                  {doc.docDate && (
                    <span className="text-muted-foreground tabular-nums">
                      {fmt.date(doc.docDate)}
                    </span>
                  )}
                  {fileHref && (
                    <a
                      href={fileHref}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link hover:underline"
                      aria-label={t('openFile', { title: doc.title })}
                    >
                      {tc('open')}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {canAdd && (
            <Button
              size="sm"
              variant="outline"
              render={
                <Link href={`/documents/new?entityType=${entityType}&entityId=${entityId}`} />
              }
            >
              <Plus className="size-4" /> {tc('add')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {docs.map((doc) => {
              const fileHref = documentHref(doc);
              return (
                <li key={doc.id} className="flex flex-wrap items-center gap-2">
                  {fileHref ? (
                    <a
                      href={fileHref}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('openFile', { title: doc.title })}
                    >
                      {doc.hasFile ? (
                        <FileText className="size-4 text-muted-foreground" />
                      ) : (
                        <ExternalLink className="size-4 text-muted-foreground" />
                      )}
                    </a>
                  ) : (
                    <FileText className="size-4 text-muted-foreground/40" />
                  )}
                  <Link href={`/documents/${doc.id}`} className="hover:underline">
                    {doc.title}
                  </Link>
                  <Badge variant="outline">{DOCUMENT_TYPE_LABELS[doc.type as DocumentType]}</Badge>
                  {doc.number && (
                    <span className="text-muted-foreground">
                      {tc('number', { number: doc.number })}
                    </span>
                  )}
                  {doc.docDate && (
                    <span className="text-muted-foreground">{fmt.date(doc.docDate)}</span>
                  )}
                  {doc.version > 1 && <Badge variant="secondary">v{doc.version}</Badge>}
                  {doc.status !== 'issued' && (
                    <Badge variant="secondary">{DOC_STATUS_LABELS[doc.status]}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
