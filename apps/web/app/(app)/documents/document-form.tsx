'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toOptions, useLabels } from '@/lib/labels';
import { createDocumentAction, type UploadState } from '@/server/actions/documents';
import { labelOf, LinkTargetSelect, type LinkTargets } from './link-target-select';

type Props = {
  targets: LinkTargets;
  initialLinks: string[];
  initialType?: string;
  cancelHref: string;
};

/** Add a document: a file (≤ 4 MB) or an external link (Vchasno, Drive), with 0..n links (6.9). */
export function DocumentForm({ targets, initialLinks, initialType, cancelHref }: Props) {
  const [state, action, pending] = useActionState<UploadState, FormData>(
    createDocumentAction,
    null,
  );
  const [links, setLinks] = useState<string[]>(initialLinks);
  const [picked, setPicked] = useState('');
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('documentForm');
  const tc = useTranslations('common');
  const { DOCUMENT_TYPE_LABELS } = useLabels();

  const addLink = () => {
    if (picked && !links.includes(picked)) setLinks([...links, picked]);
    setPicked('');
  };

  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      <input
        type="hidden"
        name="links"
        value={JSON.stringify(
          links.map((l) => {
            const [entityType, entityId] = l.split(':');
            return { entityType, entityId };
          }),
        )}
      />
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label={t('type')} htmlFor="type" error={errors?.type}>
        <NativeSelect
          id="type"
          name="type"
          defaultValue={initialType ?? 'other'}
          options={toOptions(DOCUMENT_TYPE_LABELS)}
        />
      </FormField>
      <FormField label={t('title')} htmlFor="title" error={errors?.title}>
        <Input id="title" name="title" required placeholder={t('titlePlaceholder')} />
      </FormField>
      <FormField label={t('number')} htmlFor="number" error={errors?.number}>
        <Input id="number" name="number" placeholder="1003 - А8" />
      </FormField>
      <FormField label={t('docDate')} htmlFor="docDate" error={errors?.docDate}>
        <Input id="docDate" name="docDate" type="date" />
      </FormField>
      <FormField label={t('file')} htmlFor="file" error={errors?.file}>
        <Input id="file" name="file" type="file" />
      </FormField>
      <FormField label={t('url')} htmlFor="url" hint={t('urlHint')} error={errors?.url}>
        <Input id="url" name="url" type="url" placeholder="https://" />
      </FormField>
      <FormField label={t('notes')} htmlFor="notes" className="md:col-span-2">
        <Textarea id="notes" name="notes" rows={2} />
      </FormField>

      <fieldset className="flex flex-col gap-2 md:col-span-2">
        <legend className="mb-1 text-sm font-medium">{t('links')}</legend>
        <div className="flex flex-wrap gap-2" aria-label={t('linksAria')}>
          {links.length === 0 && (
            <span className="text-sm text-muted-foreground">{t('noLinks')}</span>
          )}
          {links.map((l) => (
            <Badge key={l} variant="secondary" className="gap-1">
              {labelOf(targets, l)}
              <button
                type="button"
                aria-label={t('remove', { label: labelOf(targets, l) })}
                onClick={() => {
                  setLinks(links.filter((x) => x !== l));
                }}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <LinkTargetSelect
            targets={targets}
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value);
            }}
            aria-label={t('entity')}
          />
          <Button type="button" variant="outline" onClick={addLink} disabled={!picked}>
            {t('attach')}
          </Button>
        </div>
        {errors?.links && <p className="text-sm text-destructive">{t('checkLinks')}</p>}
      </fieldset>

      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : t('submit')}
        </Button>
        <Button variant="ghost" render={<Link href={cancelHref} />}>
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
