import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchPeople } from '@/server/services/people';
import { getTrip } from '@/server/services/trips';
import { pageTitle } from '@/server/i18n';
import { TripForm } from '../../trip-form';

export const generateMetadata = pageTitle('editTrip');

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const [card, people, t] = await Promise.all([
    getTrip.run(ctx, { id }),
    searchPeople.run(ctx, {}),
    getTranslations('trips'),
  ]);
  if (card.isErr()) notFound();
  const { trip, participants } = card.value;
  const ids = participants.map((p) => p.personId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">{t('edit')}</h1>
      </div>
      <TripForm
        value={{ ...trip, participantIds: ids }}
        people={people
          .unwrapOr([])
          .filter((p) => p.status !== 'inactive' || ids.includes(p.id))
          .map((p) => ({ id: p.id, name: p.fullName }))}
      />
    </div>
  );
}
