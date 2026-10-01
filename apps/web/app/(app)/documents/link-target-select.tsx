'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type LinkTargets = Record<
  'person' | 'client' | 'payee' | 'contract',
  { id: string; label: string }[]
>;

const GROUPS: (keyof LinkTargets)[] = ['person', 'client', 'payee', 'contract'];

/** Grouped native select; option value is `entityType:entityId`. */
export function LinkTargetSelect({
  targets,
  className,
  ...props
}: React.ComponentProps<'select'> & { targets: LinkTargets }) {
  const t = useTranslations('documents');
  return (
    <select
      className={cn(
        'h-9 min-w-56 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs',
        className,
      )}
      {...props}
    >
      <option value="">{t('chooseEntity')}</option>
      {GROUPS.map((type) =>
        targets[type].length ? (
          <optgroup key={type} label={t(`groups.${type}`)}>
            {targets[type].map((target) => (
              <option key={target.id} value={`${type}:${target.id}`}>
                {target.label}
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
