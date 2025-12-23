import { cn } from "../../lib/ui";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export default function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; full?: boolean }
) {
  const { className, variant = "primary", size = "md", full, ...rest } = props;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-11 px-5 text-base",
        variant === "primary" && "bg-[#e53137] text-white hover:bg-[#cc2b30] shadow-sm shadow-red-200",
        variant === "secondary" && "bg-white text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50",
        variant === "ghost" && "bg-transparent text-gray-700 hover:bg-gray-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        full && "w-full",
        className
      )}
      {...rest}
    />
  );
}
