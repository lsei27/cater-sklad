import type { ReactNode } from "react";
import { cn } from "../../lib/ui";

export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center overflow-x-auto rounded-[10px] border border-line bg-white p-0.5",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium whitespace-nowrap text-muted hover:text-ink focus-visible:outline-offset-[-2px]",
            value === option.value && "bg-indigo-50 text-indigo-700"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
