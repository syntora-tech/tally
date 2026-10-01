import { isAssignmentActive, type LocalDate } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ServiceContext } from '@/server/services/context';
import { listPersonAssignments } from '@/server/services/assignments';
import { getFormat } from '@/server/i18n';

/** Current and past assignments with margin by terms (finance+; spec 6.2 card, 6.3 AC). */
export async function AssignmentsCard({
  ctx,
  personId,
}: {
  ctx: ServiceContext;
  personId: string;
}) {
  const rows = (await listPersonAssignments.run(ctx, { personId })).unwrapOr([]);
  const t = await getTranslations('personAssignments');
  const fmt = await getFormat();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          render={<Link href={`/people/${personId}/assignments/new`} />}
        >
          {t('new')}
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {rows.map(({ assignment: a, clientName, contractNumber, margin }) => {
              const active = isAssignmentActive(
                { startsOn: a.startsOn as LocalDate, endsOn: a.endsOn as LocalDate | null },
                ctx.today,
              );
              return (
                <li key={a.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/people/assignments/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.isInternal ? t('internal') : clientName}
                    </Link>
                    <span className="text-muted-foreground">
                      {[a.roleTitle, a.sowRef, contractNumber].filter(Boolean).join(' · ')}
                    </span>
                    <Badge variant={active ? 'default' : 'secondary'}>
                      {active ? t('active') : t('inactive')}
                    </Badge>
                    <Badge variant="outline">FTE {a.fte}</Badge>
                  </div>
                  <div className="text-muted-foreground">
                    {fmt.date(a.startsOn)} — {a.endsOn ? fmt.date(a.endsOn) : '…'}
                    {margin && t('margin', { amount: fmt.amount(margin.margin, margin.currency) })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
