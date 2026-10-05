import { sum } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listTrips } from '@/server/services/trips';
import { getFormat, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('trips');

export default async function TripsPage() {
  const ctx = await requireRole(ALL_ROLES);
  const finance = FINANCE_ROLES.includes(ctx.actor.role);
  const [trips, t, fmt] = await Promise.all([
    listTrips.run(ctx, {}),
    getTranslations('trips'),
    getFormat(),
  ]);
  const rows = trips.unwrapOr([]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        {finance && <Button render={<Link href="/trips/new" />}>{t('new')}</Button>}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.trip')}</TableHead>
                <TableHead>{t('col.dates')}</TableHead>
                <TableHead>{t('col.participants')}</TableHead>
                <TableHead>{t('col.status')}</TableHead>
                {finance && <TableHead className="text-right">{t('col.spent')}</TableHead>}
                {finance && <TableHead className="text-right">{t('col.remaining')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.trip.id} data-testid="trip-row">
                  <TableCell>
                    <Link href={`/trips/${r.trip.id}`} className="font-medium hover:underline">
                      {r.trip.title}
                    </Link>
                    {r.trip.location && (
                      <div className="text-xs text-muted-foreground">{r.trip.location}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.trip.startsOn && r.trip.endsOn
                      ? `${fmt.date(r.trip.startsOn)} — ${fmt.date(r.trip.endsOn)}`
                      : t('noDates')}
                  </TableCell>
                  <TableCell>{r.participants.map((p) => p.name).join(', ')}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.status === 'awaiting_reimbursement' ? 'destructive' : 'outline'}
                    >
                      {t(`status.${r.status}`)}
                    </Badge>
                  </TableCell>
                  {finance && (
                    <TableCell className="text-right tabular-nums">
                      {fmt.amount(sum(r.summary.map((s) => s.spentUsd)).toFixed(2), 'USD')}
                    </TableCell>
                  )}
                  {finance && (
                    <TableCell className="text-right tabular-nums">
                      {fmt.amount(sum(r.summary.map((s) => s.remainingUah)).toFixed(2), 'UAH')}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
