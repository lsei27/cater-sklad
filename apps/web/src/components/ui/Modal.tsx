import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/ui";
import Button from "./Button";
import type { ReactNode } from "react";

export default function Modal(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  contentClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
  secondaryText?: string;
  onSecondary?: () => void;
  primaryText?: string;
  onPrimary?: () => Promise<void> | void;
  primaryDisabled?: boolean;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-900/40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white shadow-xl",
            props.contentClassName
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold">{props.title}</Dialog.Title>
              {props.description ? <Dialog.Description className="mt-1 text-sm text-slate-600">{props.description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Zavřít">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className={cn("max-h-[70vh] overflow-auto px-4 py-4", props.bodyClassName)}>
            {props.children}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
            {props.footer ?? <div />}
            <div className="flex gap-2">
              {props.onSecondary ? (
                <Button variant="secondary" onClick={props.onSecondary}>
                  {props.secondaryText ?? "Zrušit"}
                </Button>
              ) : (
                <Dialog.Close asChild>
                  <Button variant="secondary">Zavřít</Button>
                </Dialog.Close>
              )}
              {props.onPrimary ? (
                <Button disabled={props.primaryDisabled} onClick={props.onPrimary}>
                  {props.primaryText ?? "Uložit"}
                </Button>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
