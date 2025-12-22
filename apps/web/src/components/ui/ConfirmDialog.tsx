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
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-900/40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
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
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">Zrušit</Button>
            </Dialog.Close>
            <Button
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

