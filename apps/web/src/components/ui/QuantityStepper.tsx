import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/ui";

export default function QuantityStepper({
  label,
  value,
  onDecrease,
  onIncrease,
  decreaseDisabled,
  increaseDisabled,
  className,
}: {
  label: string;
  value: ReactNode;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex w-fit items-center overflow-hidden rounded-lg border border-line bg-white", className)}
    >
      <button
        type="button"
        aria-label={`Snížit množství — ${label}`}
        onClick={onDecrease}
        disabled={decreaseDisabled}
        className="grid size-8 shrink-0 place-items-center text-muted hover:bg-canvas focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Minus size={14} />
      </button>
      <span className="min-w-9 px-1 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={`Zvýšit množství — ${label}`}
        onClick={onIncrease}
        disabled={increaseDisabled}
        className="grid size-8 shrink-0 place-items-center text-muted hover:bg-canvas focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
