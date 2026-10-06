import type { DocumentType } from '@tally/db/schema';
import { ExternalLink, FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getFormat, getLabels } from '@/server/i18n';
import type { ServiceContext } from '@/server/services/context';
import {
  counterpartyDossier,
  type DossierDoc,
  type DossierShelf,
} from '@/server/services/documents/structure';
import { documentHref } from './linked-documents';

type Props = {
  ctx: ServiceContext;
  party: 'client' | 'payee';
  id: string;
  canAdd?: boolean;
};

/**
 * The counterparty's case file (A-079): contracts → SOWs/annexes → their documents, invoices,
 * bills and acts by month, and what is not filed under a contract yet.
 */
export async function CounterpartyDossier({ ctx, party, id, canAdd }: Props) {
  const result = await counterpartyDossier.run(ctx, { party, id });
  const [t, tc, fmt, labels] = await Promise.all([
    getTranslations('dossier'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);
  const { DOCUMENT_TYPE_LABELS, DOC_STATUS_LABELS, CONTRACT_STATUS_LABELS } = labels;
  if (result.isErr()) return null;
  const { contracts, unfiled } = result.value;

  const renderDoc = (d: DossierDoc) => {
    const href = documentHref(d);
    return (
      <li className="flex flex-wrap items-center gap-2">
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
        {d.status !== 'issued' && <Badge variant="secondary">{DOC_STATUS_LABELS[d.status]}</Badge>}
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

  const empty = (s: DossierShelf) => s.docs.length === 0 && s.months.length === 0;
  const signedFile = (s: DossierShelf, types: string[]) =>
    s.docs.some((d) => types.includes(d.type) && d.status !== 'void');

  return (
    <Card data-testid="dossier">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canAdd && (
          <Button
            size="sm"
            variant="outline"
            render={<Link href={`/documents/new?entityType=${party}&entityId=${id}`} />}
          >
            <Plus className="size-4" /> {tc('add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {contracts.length === 0 && empty(unfiled) && (
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
              <span className="font-normal text-muted-foreground"> · {c.total}</span>
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
        {!empty(unfiled) && (
          <div className="flex flex-col gap-2">
            <div className="font-medium">{t('unfiled')}</div>
            {renderShelf(unfiled)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
