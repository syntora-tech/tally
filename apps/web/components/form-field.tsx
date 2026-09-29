import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  htmlFor: string;
  error?: string[] | undefined;
  hint?: string;
  className?: string;
  children: React.ReactNode;
};

export function FormField({ label, htmlFor, error, hint, className, children }: Props) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error?.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error?.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

type NativeSelectProps = React.ComponentProps<'select'> & {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
};

/** Native select: works in plain GET forms and server actions without client state. */
export function NativeSelect({ options, placeholder, className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
