import { formatAmount, formatUaDate, isAssignmentActive, type LocalDate } from '@tally/domain';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ServiceContext } from '@/server/services/context';
import { listPersonAssignments } from '@/server/services/assignments';

/** Current and past assignments with margin by terms (finance+; spec 6.2 card, 6.3 AC). */
export async function AssignmentsCard({
  ctx,
  personId,
}: {
  ctx: ServiceContext;
  personId: string;
}) {
  const rows = (await listPersonAssignments.run(ctx, { personId })).unwrapOr([]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Залучення</CardTitle>
        <Button
          size="sm"
          variant="outline"
          render={<Link href={`/people/${personId}/assignments/new`} />}
        >
          Нове залучення
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Залучень ще немає</p>
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
                      {a.isInternal ? 'Внутрішнє' : clientName}
                    </Link>
                    <span className="text-muted-foreground">
                      {[a.roleTitle, a.sowRef, contractNumber].filter(Boolean).join(' · ')}
                    </span>
                    <Badge variant={active ? 'default' : 'secondary'}>
                      {active ? 'Активне' : 'Неактивне'}
                    </Badge>
                    <Badge variant="outline">FTE {a.fte}</Badge>
                  </div>
                  <div className="text-muted-foreground">
                    {formatUaDate(a.startsOn as LocalDate)} —{' '}
                    {a.endsOn ? formatUaDate(a.endsOn as LocalDate) : '…'}
                    {margin &&
                      ` · маржа за умовами ${formatAmount(margin.margin, margin.currency)}`}
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
