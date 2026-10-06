import type { DocumentType } from '@tally/db/schema';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { documentInbox } from '@/server/services/documents/structure';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { DocumentsNav } from '../documents-nav';

export const generateMetadata = pageTitle('documentsInbox');

/** Documents to sort out: unlinked, not on their contract/SOW, without a date or number (A-079). */
export default async function DocumentsInboxPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const items = (await documentInbox.run(ctx, {})).unwrapOr([]);
  const [t, fmt, { DOCUMENT_TYPE_LABELS }] = await Promise.all([
    getTranslations('documentsInbox'),
    getFormat(),
    getLabels(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <DocumentsNav current="inbox" inboxCount={items.length} />
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.document')}</TableHead>
              <TableHead>{t('col.type')}</TableHead>
              <TableHead>{t('col.date')}</TableHead>
              <TableHead>{t('col.fix')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d) => (
              <TableRow key={d.id} data-testid="inbox-row">
                <TableCell>
                  <Link className="hover:underline" href={`/documents/${d.id}`}>
                    {d.title}
                  </Link>
                  {d.number && <span className="text-muted-foreground"> · №{d.number}</span>}
                </TableCell>
                <TableCell>{DOCUMENT_TYPE_LABELS[d.type as DocumentType]}</TableCell>
                <TableCell>{d.docDate ? fmt.date(d.docDate) : '—'}</TableCell>
                <TableCell className="flex flex-wrap gap-1">
                  {d.reasons.map((r) => (
                    <Badge key={r} variant="secondary">
                      {t(`reason.${r}`)}
                    </Badge>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
