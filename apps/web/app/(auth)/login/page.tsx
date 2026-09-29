import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { publicEnv } from '@/lib/public-env';
import { getSessionActor } from '@/server/request-context';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Вхід · Tally' };

const ERRORS: Record<string, string> = {
  forbidden: 'Цей обліковий запис не має доступу до Tally.',
  auth: 'Не вдалося увійти. Спробуйте ще раз.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const actor = await getSessionActor();
  if (actor?.role) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Tally</CardTitle>
          <CardDescription>Вхід до back-office Syntora.Tech</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            error={error ? (ERRORS[error] ?? ERRORS.auth) : undefined}
            next={next}
            googleEnabled={publicEnv.googleAuthEnabled}
          />
        </CardContent>
      </Card>
    </main>
  );
}
