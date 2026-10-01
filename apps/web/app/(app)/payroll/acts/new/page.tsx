import type { Metadata } from 'next';
import Link from 'next/link';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { fopContracts } from '@/server/services/acts';
import { NewActForm } from '../act-forms';

export const metadata: Metadata = { title: 'Позачерговий акт · Tally' };

export default async function NewActPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const contracts = (await fopContracts.run(ctx, {})).unwrapOr([]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/payroll/acts" className="text-sm text-muted-foreground hover:underline">
          ← Реєстр актів
        </Link>
        <h1 className="text-2xl font-semibold">Позачерговий акт</h1>
        <p className="text-muted-foreground">Компенсація поїздки чи інша послуга з ручною датою</p>
      </div>
      <NewActForm
        today={ctx.today}
        contracts={contracts.map((c) => ({ id: c.id, label: `${c.payeeName} · ${c.number}` }))}
      />
    </div>
  );
}
