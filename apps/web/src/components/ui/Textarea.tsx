import { cn } from "../../lib/ui";
import type { TextareaHTMLAttributes } from "react";

export default function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-[9px] border border-line bg-white px-3 py-2 text-sm placeholder:text-muted focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 focus:outline-none",
        props.className
      )}
    />
  );
}
