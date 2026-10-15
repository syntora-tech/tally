'use client';

import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { useIsV2 } from '@/components/v2/ui-version';

/**
 * File field: v1 keeps the browser's input; v2 shows a drop zone (the transparent input covers it,
 * so both a click and a dropped file land in the same form field) with the chosen file's name.
 */
export function FileInput({
  compact = false,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { compact?: boolean }) {
  const v2 = useIsV2();
  const t = useTranslations('common');
  const [name, setName] = useState<string | null>(null);
  if (!v2) return <Input type="file" {...props} />;
  const input = (
    <input
      {...props}
      type="file"
      className="absolute inset-0 cursor-pointer opacity-0"
      onChange={(e) => {
        setName(e.target.files?.[0]?.name ?? null);
        props.onChange?.(e);
      }}
    />
  );
  if (compact) {
    return (
      <span className="relative inline-flex h-9 max-w-56 items-center gap-2 rounded-md border border-dashed border-input bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40">
        <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{name ?? t('chooseFile')}</span>
        {input}
      </span>
    );
  }
  return (
    <span className="relative flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input bg-card px-4 py-5 text-center focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40">
      <Upload className="size-5 text-muted-foreground" aria-hidden />
      <span className="max-w-full truncate font-medium">{name ?? t('dropFile')}</span>
      {!name && <span className="text-xs text-muted-foreground">{t('dropFileHint')}</span>}
      {input}
    </span>
  );
}
