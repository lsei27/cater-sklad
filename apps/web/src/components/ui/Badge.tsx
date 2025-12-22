import { cn } from "../../lib/ui";
import type { HTMLAttributes } from "react";

export default function Badge(
  props: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "ok" | "warn" | "danger" }
) {
  const { className, tone = "neutral", ...rest } = props;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-slate-100 text-slate-700",
        tone === "ok" && "bg-emerald-100 text-emerald-700",
        tone === "warn" && "bg-amber-100 text-amber-800",
        tone === "danger" && "bg-red-100 text-red-700",
        className
      )}
      {...rest}
    />
  );
}

