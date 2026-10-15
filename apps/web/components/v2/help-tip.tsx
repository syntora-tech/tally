'use client';

import { Popover } from '@base-ui/react/popover';
import { cn } from 'cn';
import type { ReactNode } from 'react';

/** The (?) next to a title: the explanation v1 printed as a subtitle, on hover or tap. */
export function HelpTip({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={label}
        className={cn(
          'inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full border border-input bg-background text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          className,
        )}
      >
        ?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="isolate z-50">
          <Popover.Popup className="max-w-xs rounded-md border border-white/10 bg-[#0E0E11] px-3 py-2.5 text-[13px] leading-snug font-normal text-[#FCFCFC] shadow-lg outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
