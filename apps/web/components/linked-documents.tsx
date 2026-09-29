import { formatUaDate, type LocalDate } from '@tally/domain';
import type { LinkEntityType } from '@tally/db/schema';
import { ExternalLink, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import type { DocumentType } from '@tally/db/schema';
import type { ServiceContext } from '@/server/services/context';
import { documentsForEntity } from '@/server/services/documents/read';

type Props = {
  ctx: ServiceContext;
  entityType: LinkEntityType;
  entityId: string;
  /** Optional action slot, e.g. an upload button. */
  action?: React.ReactNode;
};

export function documentHref(doc: { id: string; hasFile: boolean; url: string | null }) {
  return doc.hasFile ? `/api/files/${doc.id}` : doc.url;
}

export async function LinkedDocuments({ ctx, entityType, entityId, action }: Props) {
  const result = await documentsForEntity.run(ctx, { entityType, entityId });
  const docs = result.isOk() ? result.value : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Документи</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Документів ще немає</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {docs.map((doc) => {
              const href = documentHref(doc);
              return (
                <li key={doc.id} className="flex items-center gap-2">
                  {doc.hasFile ? (
                    <FileText className="size-4 text-muted-foreground" />
                  ) : (
                    <ExternalLink className="size-4 text-muted-foreground" />
                  )}
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                      {doc.title}
                    </a>
                  ) : (
                    <span>{doc.title}</span>
                  )}
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
