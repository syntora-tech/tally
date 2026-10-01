'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createMcpClientAction,
  revokeMcpClientAction,
  type SettingsFormState,
} from '@/server/actions/settings';

const PROFILES = ['read_only', 'assistant'] as const;
const PROFILE_KEYS = { read_only: 'readOnly', assistant: 'assistant' } as const;

function issuedToken(state: SettingsFormState): string | null {
  if (!state?.ok) return null;
  const data = state.data as { token?: unknown };
  return typeof data.token === 'string' ? data.token : null;
}

/** The token is shown once, right after creation; only its hash is stored. */
export function CreateMcpClientForm({ mcpUrl }: { mcpUrl: string }) {
  const [state, action, pending] = useActionState(createMcpClientAction, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const token = issuedToken(state);
  const t = useTranslations('mcpForms');
  useEffect(() => {
    if (state && !state.ok && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state]);
  const command = token
    ? `claude mcp add --transport http tally ${mcpUrl} --header "Authorization: Bearer ${token}"`
    : '';

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <FormField label={t('name')} htmlFor="mcp-name" error={errors?.clientName}>
          <Input
            id="mcp-name"
            name="clientName"
            required
            placeholder="Claude Code — Ledger"
            className="w-72"
          />
        </FormField>
        <FormField label={t('access')} htmlFor="mcp-profile" error={errors?.profile}>
          <select
            id="mcp-profile"
            name="profile"
            defaultValue="read_only"
            className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm"
          >
            {PROFILES.map((p) => (
              <option key={p} value={p}>
                {t(PROFILE_KEYS[p])}
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" disabled={pending}>
          {t('create')}
        </Button>
      </form>
      {token && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t('copyNow')}</p>
          <code className="break-all rounded bg-muted px-2 py-1">{token}</code>
          <p className="text-muted-foreground">{t('connect')}</p>
          <code className="break-all rounded bg-muted px-2 py-1">{command}</code>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(command).then(() => {
                  toast.success(t('copied'));
                });
              }}
            >
              <Copy className="size-4" /> {t('copy')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeMcpClientButton({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(revokeMcpClientAction, null);
  const t = useTranslations('mcpForms');
  useEffect(() => {
    if (state?.ok) toast.success(t('revoked'));
    else if (state) toast.error(state.error.message);
  }, [state, t]);
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('revoke')}
      </Button>
    </form>
  );
}
