import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { publicEnv } from '@/lib/public-env';
import { getSessionActor } from '@/server/request-context';
import { LoginForm } from './login-form';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('login');

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const actor = await getSessionActor();
  if (actor?.role) redirect('/dashboard');
  const t = await getTranslations('login');

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Tally</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            error={error ? t(error === 'forbidden' ? 'errorForbidden' : 'errorAuth') : undefined}
            next={next}
            googleEnabled={publicEnv.googleAuthEnabled}
          />
        </CardContent>
      </Card>
    </main>
  );
}
