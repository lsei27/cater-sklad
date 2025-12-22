import { cn } from "../../lib/ui";
import type { SelectHTMLAttributes } from "react";

export default function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-slate-400 focus:ring-2 disabled:opacity-50",
        props.className
      )}
    />
  );
}

