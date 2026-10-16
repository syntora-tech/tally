'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * A form rendered inside a v2 dialog drops its own toggle (button, <details>) and closes the
 * dialog on success; in v1 there is no provider and forms behave as before.
 */
const DialogScope = createContext<{ close: () => void } | null>(null);

export function useDialogScope() {
  return useContext(DialogScope);
}

/** Closes the surrounding v2 dialog once its form succeeds; no-op outside a dialog (v1). */
export function useCloseOnSuccess(state: { ok: boolean } | null | undefined) {
  const dialog = useDialogScope();
  useEffect(() => {
    if (state?.ok) dialog?.close();
  }, [state, dialog]);
}

export type DialogSpec = {
  title: string;
  description?: string;
  content: ReactNode;
  /** For forms laid out in a grid of many fields. */
  wide?: boolean;
};

function FormDialog({
  spec,
  open,
  onOpenChange,
}: {
  spec: DialogSpec;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Stable across renders: forms list the scope in effect deps and must not re-fire on it.
  const onChange = useRef(onOpenChange);
  useEffect(() => {
    onChange.current = onOpenChange;
  });
  const scope = useMemo(
    () => ({
      close: () => {
        onChange.current(false);
      },
    }),
    [],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={spec.wide ? 'max-w-3xl' : undefined}>
        <DialogTitle>{spec.title}</DialogTitle>
        {spec.description && <DialogDescription>{spec.description}</DialogDescription>}
        <DialogScope.Provider value={scope}>{open && spec.content}</DialogScope.Provider>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A dialog that is open when the page loads, for a link that asks for it (e.g. "pay this payout
 * with this transaction"); closing it drops that request from the URL.
 */
export function OpenedDialog({ closeHref, ...spec }: DialogSpec & { closeHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <FormDialog
      spec={spec}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) router.replace(closeHref, { scroll: false });
      }}
    />
  );
}

/** A button that opens a form in a dialog — the primary action of a row or page. */
export function DialogButton({
  children,
  variant = 'default',
  size = 'sm',
  className,
  testId,
  ...spec
}: DialogSpec & {
  children: ReactNode;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'default';
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        data-testid={testId}
        onClick={() => {
          setOpen(true);
        }}
      >
        {children}
      </Button>
      <FormDialog spec={spec} open={open} onOpenChange={setOpen} />
    </>
  );
}

type MenuItem =
  | { label: string; dialog: DialogSpec; destructive?: boolean }
  | { label: string; href: string; download?: boolean }
  | 'separator';

/** Falsy entries are skipped, so conditional actions read as `cond && {…}`. */
export type MenuEntry = MenuItem | false | '' | 0 | null | undefined;

/** The ⋯ menu of a row or a page: rare actions, each opening its form in a dialog. */
export function RowMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  // By label, not position: after a form succeeds the page re-renders with other entries, and an
  // index would then point at a different action (e.g. "Void…" right after issuing).
  const [opened, setOpened] = useState<string | null>(null);
  const visible: MenuItem[] = [];
  for (const e of entries) {
    if (!e || (e === 'separator' && (visible.length === 0 || visible.at(-1) === 'separator'))) {
      continue;
    }
    visible.push(e);
  }
  while (visible.at(-1) === 'separator') visible.pop();
  if (!visible.some((e) => e !== 'separator')) return null;
  const current = visible.find(
    (e): e is Extract<MenuItem, { dialog: DialogSpec }> =>
      e !== 'separator' && 'dialog' in e && e.label === opened,
  );
  // The entry went away (its action is done), so nothing stays open to pop up later.
  if (opened !== null && !current) setOpened(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label={label} title={label} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {visible.map((e, i) =>
            e === 'separator' ? (
              <DropdownMenuSeparator key={`sep-${String(i)}`} />
            ) : 'href' in e ? (
              <DropdownMenuItem
                key={e.label}
                render={e.download ? <a href={e.href} /> : <Link href={e.href} />}
              >
                {e.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                key={e.label}
                variant={e.destructive ? 'destructive' : 'default'}
                onClick={() => {
                  setOpened(e.label);
                }}
              >
                {e.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {current && (
        <FormDialog
          spec={current.dialog}
          open
          onOpenChange={(o) => {
            if (!o) setOpened(null);
          }}
        />
      )}
    </>
  );
}
