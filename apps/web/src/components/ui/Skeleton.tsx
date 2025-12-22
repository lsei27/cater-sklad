import { cn } from "../../lib/ui";
import type { HTMLAttributes } from "react";

export default function Skeleton(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("animate-pulse rounded-xl bg-slate-100", props.className)} />;
}

