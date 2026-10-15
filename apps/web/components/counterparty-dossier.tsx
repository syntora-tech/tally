import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ServiceContext } from '@/server/services/context';
import { counterpartyDossier } from '@/server/services/documents/structure';
import { DossierView } from './dossier-view';
import { Panel } from '@/components/v2/panel';
import { getUiPrefs } from '@/server/ui-prefs';

type Props = {
  ctx: ServiceContext;
  party: 'client' | 'payee';
  id: string;
  canAdd?: boolean;
};

/** The counterparty's case file on its own page (A-079). */
export async function CounterpartyDossier({ ctx, party, id, canAdd }: Props) {
  const result = await counterpartyDossier.run(ctx, { party, id });
  const [t, tc] = await Promise.all([getTranslations('dossier'), getTranslations('common')]);
  if (result.isErr()) return null;
  const add = canAdd && (
    <Button
      size="sm"
      variant="outline"
      render={<Link href={`/documents/new?entityType=${party}&entityId=${id}`} />}
    >
      <Plus className="size-4" /> {tc('add')}
    </Button>
  );

  if ((await getUiPrefs()).version === 'v2') {
    return (
      <Panel
        title={t('title')}
        help={t('description')}
        helpLabel={tc('help')}
        action={add}
        testId="dossier"
      >
        <DossierView dossier={result.value} />
      </Panel>
    );
  }

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
      <CardContent>
        <DossierView dossier={result.value} />
      </CardContent>
    </Card>
  );
}
