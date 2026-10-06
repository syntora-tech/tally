import type { DocumentType } from '@tally/db/schema';
import { ExternalLink, FileText } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { getFormat, getLabels, getLocalizeText } from '@/server/i18n';
import type { Dossier, DossierDoc, DossierShelf } from '@/server/services/documents/structure';
import { documentHref } from './linked-documents';

async function dossierRenderers() {
  const [t, fmt, labels, localize] = await Promise.all([
    getTranslations('dossier'),
    getFormat(),
    getLabels(),
    getLocalizeText(),
  ]);
  const { DOCUMENT_TYPE_LABELS, DOC_STATUS_LABELS } = labels;

  const renderDoc = (d: DossierDoc) => {
    const href = documentHref(d);
    return (
      <li className="flex flex-col gap-1" data-testid="dossier-doc">
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={t('openFile', { title: d.title })}
            >
              {d.hasFile ? (
                <FileText className="size-4 text-muted-foreground" />
              ) : (
                <ExternalLink className="size-4 text-muted-foreground" />
              )}
            </a>
          ) : (
            <FileText className="size-4 text-muted-foreground/40" />
          )}
          <Link href={`/documents/${d.id}`} className="hover:underline">
            {d.title}
          </Link>
          <Badge variant="outline">{DOCUMENT_TYPE_LABELS[d.type as DocumentType]}</Badge>
          {d.docDate && <span className="text-muted-foreground">{fmt.date(d.docDate)}</span>}
          {d.packageId && (
            <Link
              href={`/documents/${d.packageId}`}
              className="text-xs text-muted-foreground hover:underline"
            >
              {t('partOf', { pages: d.packagePages ?? '' })}
            </Link>
          )}
          {d.historical && <Badge variant="secondary">{t('historical')}</Badge>}
          {d.status !== 'issued' && (
            <Badge variant="secondary">{DOC_STATUS_LABELS[d.status]}</Badge>
          )}
        </div>
        {d.links && d.links.length > 0 && (
          <details className="pl-6 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {t('links', { count: d.links.length })}
            </summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {d.links.map((l) => (
                <Badge key={`${l.entityType}:${l.entityId}`} variant="secondary">
                  {l.href ? (
                    <Link href={l.href as never}>{localize(l.label)}</Link>
                  ) : (
                    localize(l.label)
                  )}
                </Badge>
              ))}
            </div>
          </details>
        )}
      </li>
    );
  };

  const renderShelf = (shelf: DossierShelf) => (
    <div className="flex flex-col gap-2">
      {shelf.docs.length > 0 && (
        <ul className="flex flex-col gap-1">
          {shelf.docs.map((d) => (
            <Fragment key={d.id}>{renderDoc(d)}</Fragment>
          ))}
        </ul>
      )}
      {shelf.months.map((m) => (
        <details key={m.month ?? 'undated'} className="rounded border px-2 py-1">
          <summary className="cursor-pointer text-muted-foreground">
            {m.month ? fmt.month(`${m.month}-01`) : t('undated')} · {m.docs.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {m.docs.map((d) => (
              <Fragment key={d.id}>{renderDoc(d)}</Fragment>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );

  return { t, fmt, labels, renderShelf };
}

export const isEmptyShelf = (s: DossierShelf) => s.docs.length === 0 && s.months.length === 0;

/** Documents without a contract: agreements by date and the rest by month (A-079). */
export async function ShelfView({ shelf }: { shelf: DossierShelf }) {
  const { renderShelf } = await dossierRenderers();
  return renderShelf(shelf);
}

/**
 * A case file (A-079): contracts → SOWs/annexes → their documents, invoices, bills and acts by
 * month, and what is not filed under a contract yet.
 */
export async function DossierView({ dossier }: { dossier: Dossier }) {
  const { t, fmt, labels, renderShelf } = await dossierRenderers();
  const { CONTRACT_STATUS_LABELS } = labels;
  const { contracts, unfiled } = dossier;
  const signedFile = (s: DossierShelf, types: string[]) =>
    s.docs.some((d) => types.includes(d.type) && d.status !== 'void');

  return (
    <div className="flex flex-col gap-4 text-sm">
      {contracts.length === 0 && isEmptyShelf(unfiled) && (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}
      {contracts.map((c) => (
        <details
          key={c.id}
          open={c.status === 'active'}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <summary className="cursor-pointer font-medium">
            {t('contract', { number: c.number })}
            {c.signedOn && (
              <span className="font-normal text-muted-foreground"> · {fmt.date(c.signedOn)}</span>
            )}
            {c.status !== 'active' && (
              <span className="font-normal text-muted-foreground">
                {' '}
                · {CONTRACT_STATUS_LABELS[c.status]}
              </span>
            )}
            <span className="font-normal text-muted-foreground"> · {c.total}</span>{' '}
            <Link
              href={`/clients/contracts/${c.id}`}
              className="text-xs font-normal text-muted-foreground hover:underline"
            >
              {t('openContract')}
            </Link>
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {!signedFile(c, ['contract', 'package']) && (
              <p className="text-amber-600">{t('noFile')}</p>
            )}
            {renderShelf(c)}
            {c.annexes.map((a) => (
              <div key={a.id} className="flex flex-col gap-1 border-l-2 pl-3">
                <div className="font-medium">
                  {t(a.kind === 'sow' ? 'sow' : 'annex', { number: a.number })}
                  {a.title && <span className="font-normal"> · {a.title}</span>}
                  {a.status !== 'active' && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · {t(`annexStatus.${a.status as 'draft' | 'ended'}`)}
                    </span>
                  )}
                </div>
                {!signedFile(a, ['sow', 'annex', 'package']) && (
                  <p className="text-amber-600">{t('noFile')}</p>
                )}
                {renderShelf(a)}
              </div>
            ))}
          </div>
        </details>
      ))}
      {!isEmptyShelf(unfiled) && (
        <div className="flex flex-col gap-2">
          <div className="font-medium">{t('unfiled')}</div>
          {renderShelf(unfiled)}
        </div>
      )}
    </div>
  );
}
