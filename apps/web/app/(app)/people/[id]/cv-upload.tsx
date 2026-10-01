'use client';

import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { uploadPersonCv, type UploadState } from '@/server/actions/documents';

export function CvUpload({ personId }: { personId: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadPersonCv, null);
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations('cv');

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(t('uploaded'));
      formRef.current?.reset();
    } else {
      toast.error(state.error.fieldErrors?.file?.[0] ?? state.error.message);
    }
  }, [state, t]);

  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <input type="hidden" name="personId" value={personId} />
      <input
        type="file"
        name="file"
        accept="application/pdf,.pdf"
        required
        aria-label={t('file')}
        className="max-w-48 text-xs file:mr-2 file:rounded file:border file:bg-transparent file:px-2 file:py-1 file:text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <Upload className="size-4" />
        {pending ? t('uploading') : t('new')}
      </Button>
    </form>
  );
}
