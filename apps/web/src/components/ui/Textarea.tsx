import { cn } from "../../lib/ui";
import type { TextareaHTMLAttributes } from "react";

export default function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-slate-400 placeholder:text-slate-400 focus:ring-2",
        props.className
      )}
    />
  );
}
