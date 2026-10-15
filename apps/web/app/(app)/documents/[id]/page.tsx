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
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { DialogButton } from '@/components/v2/form-dialog';
import { CardLayout, Fact, Facts, FactsRule, Panel } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';

export const generateMetadata = pageTitle('document');

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(ALL_ROLES);
  const { id } = await params;
  const result = await getDocument.run(ctx, { id });
  if (result.isErr()) notFound();
  const { document: d, links, supersededById, package: pkg, parts } = result.value;
  const isFinance = FINANCE_ROLES.includes(ctx.actor.role);
  const targets = isFinance ? (await linkTargets.run(ctx, {}))._unsafeUnwrap() : null;
  const [t, tc, fmt, { DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS }, localize] = await Promise.all([
    getTranslations('documentCard'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
    getLocalizeText(),
  ]);

  if ((await getUiPrefs()).version === 'v2') {
    const fileHref = d.driveFileId ? `/api/files/${d.id}` : d.url;
    const editForm = (
      <EditDocumentForm
        doc={{
          id: d.id,
          title: d.title,
          number: d.number,
          docDate: d.docDate,
          url: d.url,
          notes: d.notes,
          status: d.status,
          historical: d.historical,
        }}
      />
    );
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={d.title}
          badges={
            <>
              <Status tone={d.status === 'issued' ? 'success' : 'neutral'}>
                {DOC_STATUS_LABELS[d.status]}
              </Status>
              {d.historical && <Status>{t('historical')}</Status>}
              {d.version > 1 && <Status>{t('version', { version: d.version })}</Status>}
            </>
          }
          meta={[
            DOCUMENT_TYPE_LABELS[d.type as DocumentType],
            d.number ? tc('number', { number: d.number }) : null,
            d.docDate ? t('of', { date: fmt.date(d.docDate) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {isFinance && (
            <DialogButton variant="outline" title={t('edit')} wide content={editForm}>
              {tc('edit')}
            </DialogButton>
          )}
          {fileHref && (
            <Button render={<a href={fileHref} target="_blank" rel="noreferrer" />}>
              {d.driveFileId ? (
                <FileText className="size-4" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              {d.driveFileId ? t('openFile') : t('openLink')}
            </Button>
          )}
        </PageHeader>
        <CardLayout
          main={
            <>
              <Panel title={t('links')}>
                <div className="flex flex-wrap gap-2" data-testid="document-links">
                  {links.length === 0 && (
                    <span className="text-muted-foreground">{t('noLinks')}</span>
                  )}
                  {links.map((l) => (
                    <span
                      key={`${l.entityType}:${l.entityId}`}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pr-1.5 pl-3"
                    >
                      {l.href ? (
                        <Link className="hover:underline" href={l.href as never}>
                          {localize(l.label)}
                        </Link>
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
                            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={t('unlink', { label: localize(l.label) })}
                          >
                            <X className="size-3" />
                          </button>
                        </form>
                      )}
                    </span>
                  ))}
                </div>
                {targets && <LinkForm documentId={d.id} targets={targets} />}
              </Panel>
              {(pkg || parts.length > 0) && (
                <Panel title={t('packageTitle')}>
                  {pkg && (
                    <p data-testid="document-package">
                      {t('partOf', { pages: d.packagePages ?? '' })}{' '}
                      <Link className="text-link hover:underline" href={`/documents/${pkg.id}`}>
                        {pkg.title}
                      </Link>
                    </p>
                  )}
                  {parts.length > 0 && <p className="text-muted-foreground">{t('packageParts')}</p>}
                  {parts.length > 0 && (
                    <ul className="flex flex-col gap-1" data-testid="document-parts">
                      {parts.map((part) => (
                        <li key={part.id}>
                          <Link
                            className="text-link hover:underline"
                            href={`/documents/${part.id}`}
                          >
                            {DOCUMENT_TYPE_LABELS[part.type as DocumentType]} · {part.title}
                          </Link>{' '}
                          <span className="text-muted-foreground">
                            {t('pages', { pages: part.pages ?? '' })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
              <AuditHistory ctx={ctx} tableName="document" rowId={d.id} />
            </>
          }
          aside={
            <Panel>
              <Facts>
                <Fact label={t('type')}>{DOCUMENT_TYPE_LABELS[d.type as DocumentType]}</Fact>
                {d.number && <Fact label={t('number')}>{d.number}</Fact>}
                {d.docDate && <Fact label={t('date')}>{fmt.date(d.docDate)}</Fact>}
                <Fact label={t('file')}>
                  {fileHref ? (
                    <a
                      className="text-link hover:underline"
                      href={fileHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {d.fileName ?? t('openLink')}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{t('noFile')}</span>
                  )}
                </Fact>
              </Facts>
              {(d.supersedesId ?? supersededById) && <FactsRule />}
              {d.supersedesId && (
                <Link className="text-link hover:underline" href={`/documents/${d.supersedesId}`}>
                  {t('previous')}
                </Link>
              )}
              {supersededById && (
                <Link className="text-link hover:underline" href={`/documents/${supersededById}`}>
                  {t('newer')}
                </Link>
              )}
              {d.notes && (
                <>
                  <FactsRule />
                  <p className="whitespace-pre-line">{d.notes}</p>
                </>
              )}
            </Panel>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{d.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <Badge variant="outline">{DOCUMENT_TYPE_LABELS[d.type as DocumentType]}</Badge>
          {d.number && <span>{tc('number', { number: d.number })}</span>}
          {d.docDate && <span>{t('of', { date: fmt.date(d.docDate) })}</span>}
          <span>· {DOC_STATUS_LABELS[d.status]}</span>
          {d.historical && <Badge variant="secondary">{t('historical')}</Badge>}
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
              {pkg && (
                <p data-testid="document-package">
                  {t('partOf', { pages: d.packagePages ?? '' })}{' '}
                  <Link className="hover:underline" href={`/documents/${pkg.id}`}>
                    {pkg.title}
                  </Link>
                </p>
              )}
              {parts.length > 0 && (
                <div className="flex flex-col gap-1" data-testid="document-parts">
                  <p className="text-muted-foreground">{t('packageParts')}</p>
                  <ul className="flex flex-col gap-1">
                    {parts.map((part) => (
                      <li key={part.id}>
                        <Link className="hover:underline" href={`/documents/${part.id}`}>
                          {DOCUMENT_TYPE_LABELS[part.type as DocumentType]} · {part.title}
                        </Link>{' '}
                        <span className="text-muted-foreground">
                          {t('pages', { pages: part.pages ?? '' })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
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
                    historical: d.historical,
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
