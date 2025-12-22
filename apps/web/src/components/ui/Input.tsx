import { cn } from "../../lib/ui";
import type { InputHTMLAttributes } from "react";

export default function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-slate-400 placeholder:text-slate-400 focus:ring-2",
        props.className
      )}
    />
  );
}

