import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TX_TYPE_LABELS } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listCategories } from '@/server/services/ledger';
import { CategoryForm } from '../ledger-forms';

export const metadata: Metadata = { title: 'Категорії · Tally' };

export default async function CategoriesPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const categories = (await listCategories.run(ctx, {})).unwrapOr([]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">Категорії</h1>
      </div>
      <CategoryForm />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {Object.entries(TX_TYPE_LABELS).map(([type, label]) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="text-base">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm">
                {categories
                  .filter((c) => c.txType === type)
                  .map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
