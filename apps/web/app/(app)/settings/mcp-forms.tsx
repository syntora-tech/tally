'use client';

import { Copy } from 'lucide-react';
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

const PROFILE_OPTIONS = [
  { value: 'read_only', label: 'Лише читання' },
  { value: 'assistant', label: 'Асистент: читання й запис Ledger' },
] as const;

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
  useEffect(() => {
    if (state && !state.ok && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state]);
  const command = token
    ? `claude mcp add --transport http tally ${mcpUrl} --header "Authorization: Bearer ${token}"`
    : '';

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <FormField label="Назва агента" htmlFor="mcp-name" error={errors?.clientName}>
          <Input
            id="mcp-name"
            name="clientName"
            required
            placeholder="Claude Code — Ledger"
            className="w-72"
          />
        </FormField>
        <FormField label="Доступ" htmlFor="mcp-profile" error={errors?.profile}>
          <select
            id="mcp-profile"
            name="profile"
            defaultValue="read_only"
            className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm"
          >
            {PROFILE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" disabled={pending}>
          Створити токен
        </Button>
      </form>
      {token && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            Скопіюйте токен зараз — більше його не буде видно. Зберігайте як пароль.
          </p>
          <code className="break-all rounded bg-muted px-2 py-1">{token}</code>
          <p className="text-muted-foreground">Підключення в Claude Code:</p>
          <code className="break-all rounded bg-muted px-2 py-1">{command}</code>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(command).then(() => {
                  toast.success('Команду скопійовано');
                });
              }}
            >
              <Copy className="size-4" /> Скопіювати команду
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeMcpClientButton({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(revokeMcpClientAction, null);
  useEffect(() => {
    if (state?.ok) toast.success('Доступ відкликано');
    else if (state) toast.error(state.error.message);
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Відкликати
      </Button>
    </form>
  );
}
