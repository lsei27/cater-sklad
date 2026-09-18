import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/ui";
import Button from "./Button";
import type { ReactNode } from "react";

export default function Modal(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-1rem)] overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl",
            "sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[92vw] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
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

          <div className={cn("max-h-[calc(100dvh-10rem)] overflow-auto px-4 py-4 sm:max-h-[70vh]", props.bodyClassName)}>
            {props.children}
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:pb-3">
            {props.footer ?? null}
            <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
              {props.onSecondary ? (
                <Button variant="secondary" className="w-full sm:w-auto" onClick={props.onSecondary}>
                  {props.secondaryText ?? "Zrušit"}
                </Button>
              ) : (
                <Dialog.Close asChild>
                  <Button variant="secondary" className="w-full sm:w-auto">Zavřít</Button>
                </Dialog.Close>
              )}
              {props.onPrimary ? (
                <Button className="w-full sm:w-auto" disabled={props.primaryDisabled} onClick={props.onPrimary}>
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
