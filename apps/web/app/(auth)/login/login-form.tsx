'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestMagicLink, signInWithGoogle, type MagicLinkState } from '@/server/actions/auth';

type Props = {
  error: string | undefined;
  next: string | undefined;
  googleEnabled: boolean;
};

export function LoginForm({ error, next, googleEnabled }: Props) {
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(
    requestMagicLink,
    null,
  );

  if (state?.ok) {
    return (
      <Alert role="status">
        <AlertDescription>
          Якщо цей email має доступ до Tally, на нього надіслано посилання для входу. Перевірте
          пошту.
        </AlertDescription>
      </Alert>
    );
  }

  const formError = state?.error;
  const emailError = formError?.fieldErrors?.email?.[0];

  return (
    <div className="flex flex-col gap-4">
      {(error ?? (formError && !emailError)) && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError?.message ?? error}</AlertDescription>
        </Alert>
      )}
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next ?? ''} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@syntora.tech"
            required
            aria-invalid={emailError ? true : undefined}
          />
          {emailError && <p className="text-sm text-destructive">{emailError}</p>}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Надсилаємо…' : 'Надіслати посилання для входу'}
        </Button>
      </form>
      {googleEnabled && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next ?? ''} />
          <Button type="submit" variant="outline" className="w-full">
            Увійти через Google
          </Button>
        </form>
      )}
    </div>
  );
}
