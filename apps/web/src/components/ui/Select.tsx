import { cn } from "../../lib/ui";
import type { SelectHTMLAttributes } from "react";

export default function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full rounded-[9px] border border-line bg-white px-3 text-sm focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 focus:outline-none disabled:opacity-50",
        props.className
      )}
    />
  );
}

