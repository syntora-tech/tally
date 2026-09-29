'use client';

import { cn } from '@/lib/utils';

export type LinkTargets = Record<
  'person' | 'client' | 'payee' | 'contract',
  { id: string; label: string }[]
>;

const GROUP_LABELS: Record<keyof LinkTargets, string> = {
  person: 'Люди',
  client: 'Клієнти',
  payee: 'Одержувачі',
  contract: 'Договори',
};

/** Grouped native select; option value is `entityType:entityId`. */
export function LinkTargetSelect({
  targets,
  className,
  ...props
}: React.ComponentProps<'select'> & { targets: LinkTargets }) {
  return (
    <select
      className={cn(
        'h-9 min-w-56 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs',
        className,
      )}
      {...props}
    >
      <option value="">Оберіть сутність…</option>
      {(Object.keys(GROUP_LABELS) as (keyof LinkTargets)[]).map((type) =>
        targets[type].length ? (
          <optgroup key={type} label={GROUP_LABELS[type]}>
            {targets[type].map((t) => (
              <option key={t.id} value={`${type}:${t.id}`}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  );
}

export function labelOf(targets: LinkTargets, value: string): string {
  const [type, id] = value.split(':') as [keyof LinkTargets, string];
  return targets[type].find((t) => t.id === id)?.label ?? value;
}
