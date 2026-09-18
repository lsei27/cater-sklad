import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../../lib/ui";
import Button from "./Button";
import { X } from "lucide-react";

export default function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl",
            "sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[92vw] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-4"
          )}
        >
          <div className="flex items-start justify-between gap-3">
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

          {props.children}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" className="w-full sm:w-auto">Zrušit</Button>
            </Dialog.Close>
            <Button
              className="w-full sm:w-auto"
              variant={props.tone === "danger" ? "danger" : "primary"}
              onClick={async () => {
                await props.onConfirm();
                props.onOpenChange(false);
              }}
            >
              {props.confirmText ?? "Potvrdit"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
