import { cn } from "../../lib/ui";
import type { InputHTMLAttributes } from "react";

export default function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-[9px] border border-line bg-white px-3 text-sm placeholder:text-muted focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 focus:outline-none",
        props.className
      )}
    />
  );
}

