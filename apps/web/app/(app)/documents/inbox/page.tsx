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
import { DocumentsHeaderV2, DocumentsNav } from '../documents-nav';
import { EmptyState } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';
import { getUiPrefs } from '@/server/ui-prefs';

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

  const v2 = (await getUiPrefs()).version === 'v2';
  if (v2) {
    return (
      <div className="flex flex-col gap-5">
        <DocumentsHeaderV2 current="inbox" help={t('subtitle')} inboxCount={items.length} />
        {items.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <section className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-normal">{t('col.document')}</th>
                  <th className="px-3 py-2.5 text-left font-normal">{t('col.type')}</th>
                  <th className="px-3 py-2.5 text-left font-normal">{t('col.date')}</th>
                  <th className="px-5 py-2.5 text-left font-normal">{t('col.fix')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} data-testid="inbox-row" className="border-t hover:bg-muted/40">
                    <td className="px-5 py-2.5">
                      <Link className="font-medium hover:underline" href={`/documents/${d.id}`}>
                        {d.title}
                      </Link>
                      {d.number && <span className="text-muted-foreground"> · №{d.number}</span>}
                    </td>
                    <td className="px-3 py-2.5">{DOCUMENT_TYPE_LABELS[d.type as DocumentType]}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {d.docDate ? fmt.date(d.docDate) : '—'}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {d.reasons.map((r) => (
                          <Status key={r} tone="warning">
                            {t(`reason.${r}`)}
                          </Status>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    );
  }
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
