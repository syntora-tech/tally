import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OWNER_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getCompany } from '@/server/services/company';
import { CompanyForm } from './company-form';

export const metadata: Metadata = { title: 'Налаштування · Tally' };

export default async function SettingsPage() {
  const ctx = await requireRole(OWNER_ROLES);
  const result = await getCompany.run(ctx, {});
  const company = result.isOk() ? result.value : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Налаштування</h1>
      <Card>
        <CardHeader>
          <CardTitle>Реквізити компанії</CardTitle>
          <CardDescription>
            Використовуються в шапках інвойсів і актів та в договорах
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm
            company={
              company && {
                nameEn: company.nameEn,
                nameUa: company.nameUa,
                legalCode: company.legalCode,
                addressEn: company.addressEn,
                addressUa: company.addressUa,
                directorEn: company.directorEn,
                directorUa: company.directorUa,
                bankDetailsEn: company.bankDetailsEn,
                bankDetailsUa: company.bankDetailsUa,
              }
            }
          />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Календар винятків, нумерація, шаблони, користувачі й фонові задачі з’являться на наступних
        етапах.
      </p>
    </div>
  );
}
