'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DOC_STATUS_LABELS, toOptions } from '@/lib/labels';
import {
  linkDocumentAction,
  updateDocumentAction,
  type UploadState,
} from '@/server/actions/documents';
import { LinkTargetSelect, type LinkTargets } from '../link-target-select';

function useToast(state: UploadState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
    else if (state) toast.error(state.error.message);
  }, [state, success]);
}

export function LinkForm({ documentId, targets }: { documentId: string; targets: LinkTargets }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(linkDocumentAction, null);
  useToast(state, 'Прив’язку додано');
  return (
    <form action={action} className="flex flex-wrap gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <LinkTargetSelect
        name="target"
        targets={targets}
        required
        aria-label="Сутність для прив’язки"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Прив’язати
      </Button>
    </form>
  );
}

export type DocumentMeta = {
  id: string;
  title: string;
  number: string | null;
  docDate: string | null;
  url: string | null;
  notes: string | null;
  status: string;
};

export function EditDocumentForm({ doc }: { doc: DocumentMeta }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(
    updateDocumentAction,
    null,
  );
  useToast(state, 'Документ збережено');
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <input type="hidden" name="id" value={doc.id} />
      <FormField label="Назва" htmlFor="title" error={errors?.title}>
        <Input id="title" name="title" required defaultValue={doc.title} />
      </FormField>
      <FormField label="Номер" htmlFor="number">
        <Input id="number" name="number" defaultValue={doc.number ?? ''} />
      </FormField>
      <FormField label="Дата" htmlFor="docDate">
        <Input id="docDate" name="docDate" type="date" defaultValue={doc.docDate ?? ''} />
      </FormField>
      <FormField label="Статус" htmlFor="status">
        <NativeSelect
          id="status"
          name="status"
          defaultValue={doc.status}
          options={toOptions(DOC_STATUS_LABELS)}
        />
      </FormField>
      <FormField label="Посилання" htmlFor="url" className="md:col-span-2" error={errors?.url}>
        <Input id="url" name="url" type="url" defaultValue={doc.url ?? ''} />
      </FormField>
      <FormField label="Нотатки" htmlFor="notes" className="md:col-span-2">
        <Textarea id="notes" name="notes" rows={2} defaultValue={doc.notes ?? ''} />
      </FormField>
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        Зберегти
      </Button>
    </form>
  );
}
