import { cn } from "../../lib/ui";
import type { HTMLAttributes } from "react";

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("rounded-xl border border-line bg-white", props.className)} />;
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("border-b border-line px-4 py-3", props.className)} />;
}

export function CardContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("px-4 py-4", props.className)} />;
}

