import type { DocumentType } from '@tally/db/schema';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { documentChecks } from '@/server/services/documents/structure';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { DocumentsNav } from '../documents-nav';

export const generateMetadata = pageTitle('documentChecks');

/** Gaps between records and documents (A-079). */
export default async function DocumentChecksPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const result = await documentChecks.run(ctx, {});
  const [t, fmt, { DOCUMENT_TYPE_LABELS, CONTRACT_KIND_LABELS }] = await Promise.all([
    getTranslations('documentChecks'),
    getFormat(),
    getLabels(),
  ]);
  const checks = result.isOk()
    ? result.value
    : {
        contractsWithoutFile: [],
        annexesWithoutFile: [],
        payeesWithoutContract: [],
        duplicateNumbers: [],
      };

  const section = (
    id: 'payees' | 'contracts' | 'annexes' | 'duplicates',
    count: number,
    children: React.ReactNode,
  ) => (
    <Card data-testid={`check-${id}`}>
      <CardHeader>
        <CardTitle className="text-base">
          {t(`${id}.title`)} ({count})
        </CardTitle>
        <CardDescription>{t(`${id}.description`)}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {count === 0 ? <p className="text-muted-foreground">{t('allGood')}</p> : children}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <DocumentsNav current="checks" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {section(
          'payees',
          checks.payeesWithoutContract.length,
          <ul className="flex flex-col gap-1">
            {checks.payeesWithoutContract.map((p) => (
              <li key={p.id}>
                <Link className="hover:underline" href={`/people/payees/${p.id}`}>
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>,
        )}
        {section(
          'contracts',
          checks.contractsWithoutFile.length,
          <ul className="flex flex-col gap-1">
            {checks.contractsWithoutFile.map((c) => (
              <li key={c.id}>
                <Link className="hover:underline" href={`/clients/contracts/${c.id}`}>
                  {c.number}
                </Link>{' '}
                <span className="text-muted-foreground">
                  · {CONTRACT_KIND_LABELS[c.kind]} · {c.party ?? '—'}
                </span>
              </li>
            ))}
          </ul>,
        )}
        {section(
          'annexes',
          checks.annexesWithoutFile.length,
          <ul className="flex flex-col gap-1">
            {checks.annexesWithoutFile.map((a) => (
              <li key={a.id}>
                <Link className="hover:underline" href={`/clients/contracts/${a.contractId}`}>
                  {t(a.kind === 'sow' ? 'sow' : 'annex', { number: a.number })}
                </Link>{' '}
                <span className="text-muted-foreground">
                  · {a.title ?? ''} · {a.contractNumber}
                </span>
              </li>
            ))}
          </ul>,
        )}
        {section(
          'duplicates',
          checks.duplicateNumbers.length,
          <ul className="flex flex-col gap-3">
            {checks.duplicateNumbers.map((g) => (
              <li key={`${g.type}:${g.number}`}>
                <div className="font-medium">
                  {DOCUMENT_TYPE_LABELS[g.type as DocumentType]} №{g.number}
                </div>
                <ul className="flex flex-col gap-1 pl-3">
                  {g.docs.map((d) => (
                    <li key={d.id}>
                      <Link className="hover:underline" href={`/documents/${d.id}`}>
                        {d.title}
                      </Link>
                      {d.docDate && (
                        <span className="text-muted-foreground"> · {fmt.date(d.docDate)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>,
        )}
      </div>
    </div>
  );
}
