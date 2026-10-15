'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsV2 } from '@/components/v2/ui-version';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AddVersionForm } from './add-version-form';
import type { BillingDefaults, PayDefaults } from './terms-fields';

type Props = { assignmentId: string; versionId: string; validFrom: string; label: string } & (
  { side: 'billing'; values: BillingDefaults } | { side: 'pay'; values: PayDefaults }
);

/** Correction of a version of an open month (A-077), in a side sheet over the versions table. */
export function EditVersionButton(props: Props) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('terms');
  const tc = useTranslations('common');
  const v2 = useIsV2();
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const common = {
    assignmentId: props.assignmentId,
    versionId: props.versionId,
    suggestedMonth: props.validFrom.slice(0, 7),
    onSaved: close,
  };

  return (
    <>
      {v2 ? (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t('editVersionAria', { month: props.label })}
          title={tc('edit')}
          onClick={() => {
            setOpen(true);
          }}
        >
          <Pencil />
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('editVersionAria', { month: props.label })}
          onClick={() => {
            setOpen(true);
          }}
        >
          {tc('edit')}
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {props.side === 'pay' ? t('editPayTitle') : t('editBillingTitle')}
            </SheetTitle>
            <SheetDescription>{t('editHint')}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {props.side === 'pay' ? (
              <AddVersionForm side="pay" defaults={props.values} {...common} />
            ) : (
              <AddVersionForm side="billing" defaults={props.values} {...common} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
