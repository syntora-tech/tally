import type { DocumentType } from '@tally/db/schema';
import { ExternalLink, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { unlinkDocumentAction } from '@/server/actions/documents';
import { requireRole } from '@/server/request-context';
import { getDocument, linkTargets } from '@/server/services/documents/registry';
import { EditDocumentForm, LinkForm } from './document-actions';
import { getTranslations } from 'next-intl/server';
import { getFormat, getLabels, getLocalizeText, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('document');

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(ALL_ROLES);
  const { id } = await params;
  const result = await getDocument.run(ctx, { id });
  if (result.isErr()) notFound();
  const { document: d, links, supersededById } = result.value;
  const isFinance = FINANCE_ROLES.includes(ctx.actor.role);
  const targets = isFinance ? (await linkTargets.run(ctx, {}))._unsafeUnwrap() : null;
  const [t, tc, fmt, { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS }, localize] = await Promise.all([
    getTranslations('documentCard'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
    getLocalizeText(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{d.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <Badge variant="outline">{DOCUMENT_TYPE_LABELS[d.type as DocumentType]}</Badge>
          {d.number && <span>{tc('number', { number: d.number })}</span>}
          {d.docDate && <span>{t('of', { date: fmt.date(d.docDate) })}</span>}
          <span>· {DOC_STATUS_LABELS[d.status]}</span>
          {d.version > 1 && (
            <Badge variant="secondary">{t('version', { version: d.version })}</Badge>
          )}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('file')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {d.driveFileId ? (
                <Button
                  variant="outline"
                  className="self-start"
                  render={<a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" />}
                >
                  <FileText className="size-4" /> {t('open', { name: d.fileName ?? '' })}
                </Button>
              ) : d.url ? (
                <Button
                  variant="outline"
                  className="self-start"
                  render={<a href={d.url} target="_blank" rel="noreferrer" />}
                >
                  <ExternalLink className="size-4" /> {t('openLink')}
                </Button>
              ) : (
                <p className="text-muted-foreground">{t('noFile')}</p>
              )}
              {d.supersedesId && (
                <Link className="hover:underline" href={`/documents/${d.supersedesId}`}>
                  {t('previous')}
                </Link>
              )}
              {supersededById && (
                <Link className="hover:underline" href={`/documents/${supersededById}`}>
                  {t('newer')}
                </Link>
              )}
              {d.notes && <p className="whitespace-pre-line">{d.notes}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('links')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2" data-testid="document-links">
                {links.length === 0 && (
                  <span className="text-sm text-muted-foreground">{t('noLinks')}</span>
                )}
                {links.map((l) => (
                  <Badge
                    key={`${l.entityType}:${l.entityId}`}
                    variant="secondary"
                    className="gap-1"
                  >
                    {l.href ? (
                      <Link href={l.href as never}>{localize(l.label)}</Link>
                    ) : (
                      localize(l.label)
                    )}
                    {isFinance && (
                      <form action={unlinkDocumentAction} className="inline-flex">
                        <input type="hidden" name="documentId" value={d.id} />
                        <input type="hidden" name="entityType" value={l.entityType} />
                        <input type="hidden" name="entityId" value={l.entityId} />
                        <button
                          type="submit"
                          aria-label={t('unlink', { label: localize(l.label) })}
                        >
                          <X className="size-3" />
                        </button>
                      </form>
                    )}
                  </Badge>
                ))}
              </div>
              {targets && <LinkForm documentId={d.id} targets={targets} />}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {isFinance && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('edit')}</CardTitle>
              </CardHeader>
              <CardContent>
                <EditDocumentForm
                  doc={{
                    id: d.id,
                    title: d.title,
                    number: d.number,
                    docDate: d.docDate,
                    url: d.url,
                    notes: d.notes,
                    status: d.status,
                  }}
                />
              </CardContent>
            </Card>
          )}
          <AuditHistory ctx={ctx} tableName="document" rowId={d.id} />
        </div>
      </div>
    </div>
  );
}
