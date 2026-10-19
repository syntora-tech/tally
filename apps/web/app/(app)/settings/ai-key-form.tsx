'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deleteAiKeyAction, saveAiKeyAction } from '@/server/actions/ai';

export type AiKeyStatus = { available: boolean; hint: string | null; verifiedAt: string | null };

/** The user's own Anthropic API key (A-120): written once, never shown again, only its tail. */
export function AiKeyForm({ status }: { status: AiKeyStatus }) {
  const t = useTranslations('aiKey');
  const [saved, save, saving] = useActionState(saveAiKeyAction, null);
  const [removed, remove, removing] = useActionState(deleteAiKeyAction, null);
  const form = useRef<HTMLFormElement>(null);
  const errors = saved && !saved.ok ? saved.error.fieldErrors : undefined;

  useEffect(() => {
    if (saved?.ok) {
      toast.success(t('saved'));
      form.current?.reset();
    } else if (saved && !saved.error.fieldErrors) toast.error(saved.error.message);
  }, [saved, t]);
  useEffect(() => {
    if (removed?.ok) toast.success(t('deleted'));
    else if (removed) toast.error(removed.error.message);
  }, [removed, t]);

  if (!status.available) {
    return <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {status.hint ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="ai-key-current">
          <span>
            {t('current', { hint: status.hint })}
            {status.verifiedAt ? ` · ${t('verified', { date: status.verifiedAt })}` : ''}
          </span>
          <form action={remove}>
            <Button type="submit" variant="outline" size="sm" disabled={removing}>
              {t('delete')}
            </Button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      )}
      <form ref={form} action={save} className="flex flex-wrap items-end gap-3">
        <FormField
          label={status.hint ? t('replace') : t('label')}
          htmlFor="ai-key"
          error={errors?.apiKey}
          hint={t('hint')}
        >
          <Input
            id="ai-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="sk-ant-api03-…"
            className="w-96 max-w-full font-mono"
          />
        </FormField>
        <Button type="submit" disabled={saving}>
          {saving ? t('checking') : t('save')}
        </Button>
      </form>
    </div>
  );
}
