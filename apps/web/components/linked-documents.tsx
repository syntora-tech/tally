import type { DocumentType, LinkEntityType } from '@tally/db/schema';
import { formatUaDate, type LocalDate } from '@tally/domain';
import { ExternalLink, FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import type { ServiceContext } from '@/server/services/context';
import { documentsForEntity } from '@/server/services/documents/read';

type Props = {
  ctx: ServiceContext;
  entityType: LinkEntityType;
  entityId: string;
  /** Shows "Додати" leading to the document form with this entity pre-linked. */
  canAdd?: boolean;
  /** Extra action, e.g. the CV upload on a person card. */
  action?: React.ReactNode;
};

export function documentHref(doc: { id: string; hasFile: boolean; url: string | null }) {
  return doc.hasFile ? `/api/files/${doc.id}` : doc.url;
}

/** Documents attached to an entity; every card shows them (spec 6). */
export async function LinkedDocuments({ ctx, entityType, entityId, canAdd, action }: Props) {
  const result = await documentsForEntity.run(ctx, { entityType, entityId });
  const docs = result.isOk() ? result.value : [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Документи</CardTitle>
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
              <Plus className="size-4" /> Додати
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Документів ще немає</p>
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
                      aria-label={`Відкрити файл ${doc.title}`}
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
                  {doc.number && <span className="text-muted-foreground">№ {doc.number}</span>}
                  {doc.docDate && (
                    <span className="text-muted-foreground">
                      {formatUaDate(doc.docDate as LocalDate)}
                    </span>
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
