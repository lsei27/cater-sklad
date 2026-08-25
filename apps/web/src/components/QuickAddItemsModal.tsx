import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { Search } from "lucide-react";
import { api, getCurrentUser } from "../lib/api";
import { humanError } from "../lib/viewModel";
import { cn } from "../lib/ui";
import Input from "./ui/Input";
import Modal from "./ui/Modal";
import Skeleton from "./ui/Skeleton";

type CategoryRef = {
  id: string;
  name: string;
  sortOrder?: number | null;
};

type QuickInventoryItem = {
  itemId: string;
  name: string;
  unit: string | null;
  masterPackageQty: number | null;
  category: {
    parent: CategoryRef;
    sub: CategoryRef | null;
  };
};

export type QuickAddExistingItem = {
  inventoryItemId: string;
  reservedQuantity: number;
  createdById?: string;
};

type AvailabilityRow = {
  inventoryItemId: string;
  physicalTotal: number;
  blockedTotal: number;
  available: number;
};

type MasterPackageAdjustment = {
  inventoryItemId: string;
  requestedQty: number;
  adjustedQty: number;
  masterPackageQty: number | null;
};

type ReserveResponse = {
  masterPackageAdjustments?: MasterPackageAdjustment[];
};

type ApiErrorDetails = {
  error?: {
    code?: string;
    message?: string;
    inventory_item_id?: string;
    available?: number;
  };
};

type ItemGroup = {
  key: string;
  title: string;
  items: QuickInventoryItem[];
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs");
}

function parseQuantity(raw: string): number | null {
  if (raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
  return value;
}

function effectiveQuantity(item: QuickInventoryItem, requestedQuantity: number) {
  const packageSize = item.masterPackageQty ?? 0;
  if (requestedQuantity <= 0 || packageSize <= 0) return requestedQuantity;
  return Math.ceil(requestedQuantity / packageSize) * packageSize;
}

function asApiErrorDetails(error: unknown): ApiErrorDetails {
  if (typeof error !== "object" || error === null) return {};
  return error as ApiErrorDetails;
}

function canModifyExistingItem(
  role: string,
  currentUserId: string | undefined,
  existing: QuickAddExistingItem | undefined
) {
  if (!existing) return true;
  if (role === "admin") return true;
  if (["event_manager", "warehouse"].includes(role)) {
    return !existing.createdById || existing.createdById === currentUserId;
  }
  return false;
}

export default function QuickAddItemsModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  role: string;
  existingItems: QuickAddExistingItem[];
  onDone: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<QuickInventoryItem[]>([]);
  const [availability, setAvailability] = useState<Map<string, AvailabilityRow>>(new Map());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitErrorItemId, setSubmitErrorItemId] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const currentUserId = getCurrentUser()?.id;

  const existingByItemId = useMemo(
    () => new Map(props.existingItems.map((item) => [item.inventoryItemId, item])),
    [props.existingItems]
  );

  useEffect(() => {
    if (!props.open) return;

    const sequence = ++loadSequence.current;
    const initialQuantities: Record<string, string> = {};
    for (const item of props.existingItems) {
      if (item.reservedQuantity > 0) {
        initialQuantities[item.inventoryItemId] = String(item.reservedQuantity);
      }
    }

    setQuantities(initialQuantities);
    setSearch("");
    setSubmitErrorItemId(null);
    setLoadError(null);
    setLoading(true);

    api<{ items: QuickInventoryItem[] }>("/inventory/items?active=true")
      .then(async (inventoryResponse) => {
        if (sequence !== loadSequence.current) return;
        setItems(inventoryResponse.items);
        if (inventoryResponse.items.length === 0) {
          setAvailability(new Map());
          return;
        }

        const availabilityResponse = await api<{ rows: AvailabilityRow[] }>(
          `/events/${props.eventId}/availability`,
          {
            method: "POST",
            body: JSON.stringify({
              inventory_item_ids: inventoryResponse.items.map((item) => item.itemId)
            })
          }
        );
        if (sequence !== loadSequence.current) return;
        setAvailability(
          new Map(availabilityResponse.rows.map((row) => [row.inventoryItemId, row]))
        );
      })
      .catch((error: unknown) => {
        if (sequence !== loadSequence.current) return;
        setLoadError(humanError(error));
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
  }, [props.open, props.eventId, props.existingItems]);

  const visibleItems = useMemo(() => {
    const query = normalizeSearchText(search.trim());
    if (!query) return items;
    const tokens = query.split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      const categoryLabel = `${item.category.parent.name} ${item.category.sub?.name ?? ""}`;
      const haystack = normalizeSearchText(`${item.name} ${categoryLabel}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [items, search]);

  const groups = useMemo(() => {
    const groupsByKey = new Map<string, ItemGroup>();
    for (const item of visibleItems) {
      const categoryTitle = item.category.sub
        ? `${item.category.parent.name} / ${item.category.sub.name}`
        : item.category.parent.name;
      const key = `${item.category.parent.id}:${item.category.sub?.id ?? "main"}`;
      const group = groupsByKey.get(key) ?? { key, title: categoryTitle, items: [] };
      group.items.push(item);
      groupsByKey.set(key, group);
    }
    return Array.from(groupsByKey.values());
  }, [visibleItems]);

  const changes = useMemo(() => {
    return items.flatMap((item) => {
      const existing = existingByItemId.get(item.itemId);
      if (!canModifyExistingItem(props.role, currentUserId, existing)) return [];

      const requestedQuantity = parseQuantity(quantities[item.itemId] ?? "");
      const originalQuantity = existing?.reservedQuantity ?? 0;
      if (requestedQuantity === null || requestedQuantity === originalQuantity) return [];

      const available = availability.get(item.itemId)?.available ?? 0;
      const effective = effectiveQuantity(item, requestedQuantity);
      return [{ item, requestedQuantity, effective, available }];
    });
  }, [availability, currentUserId, existingByItemId, items, props.role, quantities]);

  const invalidItemIds = useMemo(() => {
    return items.flatMap((item) => {
      const existing = existingByItemId.get(item.itemId);
      if (!canModifyExistingItem(props.role, currentUserId, existing)) return [];

      const requestedQuantity = parseQuantity(quantities[item.itemId] ?? "");
      if (requestedQuantity === null) return [item.itemId];
      if (requestedQuantity === (existing?.reservedQuantity ?? 0)) return [];

      const available = availability.get(item.itemId)?.available ?? 0;
      return effectiveQuantity(item, requestedQuantity) > available ? [item.itemId] : [];
    });
  }, [availability, currentUserId, existingByItemId, items, props.role, quantities]);
  const filledCount = items.filter((item) => (parseQuantity(quantities[item.itemId] ?? "") ?? 0) > 0).length;

  const focusAdjacentInput = (itemId: string, direction: 1 | -1) => {
    const currentIndex = visibleItems.findIndex((item) => item.itemId === itemId);
    if (currentIndex < 0) return;
    for (
      let index = currentIndex + direction;
      index >= 0 && index < visibleItems.length;
      index += direction
    ) {
      const input = inputRefs.current.get(visibleItems[index].itemId);
      if (input && !input.disabled) {
        input.focus();
        input.select();
        return;
      }
    }
  };

  const handleQuantityKeyDown = (event: KeyboardEvent<HTMLInputElement>, itemId: string) => {
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      focusAdjacentInput(itemId, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAdjacentInput(itemId, -1);
    }
  };

  const submit = async () => {
    if (changes.length === 0 || invalidItemIds.length > 0) return;
    setSaving(true);
    setSubmitErrorItemId(null);
    try {
      const response = await api<ReserveResponse>(`/events/${props.eventId}/reserve`, {
        method: "POST",
        body: JSON.stringify({
          items: changes.map((change) => ({
            inventory_item_id: change.item.itemId,
            qty: change.requestedQuantity
          }))
        })
      });

      await props.onDone();
      const adjustmentCount = response.masterPackageAdjustments?.length ?? 0;
      toast.success(
        adjustmentCount > 0
          ? `Změny byly vloženy. ${adjustmentCount} položek server zaokrouhlil na celá balení.`
          : `Změny byly vloženy do akce (${changes.length} položek).`
      );
      props.onOpenChange(false);
    } catch (error: unknown) {
      const details = asApiErrorDetails(error);
      const itemId = details.error?.inventory_item_id;
      if (itemId) {
        setSubmitErrorItemId(itemId);
        const available = details.error?.available;
        if (typeof available === "number") {
          setAvailability((current) => {
            const next = new Map(current);
            const previous = next.get(itemId);
            next.set(itemId, {
              inventoryItemId: itemId,
              physicalTotal: previous?.physicalTotal ?? available,
              blockedTotal: previous?.blockedTotal ?? 0,
              available
            });
            return next;
          });
        }
        setSearch("");
        window.requestAnimationFrame(() => inputRefs.current.get(itemId)?.focus());
      }
      toast.error(humanError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Zjednodušené přidání položek"
      description="Vyplňte požadované množství jako v tabulce. Prázdné pole znamená 0."
      contentClassName="w-[96vw] max-w-[96vw]"
      bodyClassName="h-[76vh] overflow-hidden px-0 py-0"
      footer={
        <div className="text-xs text-slate-600">
          Vyplněno <span className="font-semibold text-slate-900">{filledCount}</span>
          <span className="mx-2 text-slate-300">•</span>
          Změny <span className="font-semibold text-indigo-700">{changes.length}</span>
          {invalidItemIds.length > 0 ? (
            <span className="ml-2 font-semibold text-red-700">· Opravte {invalidItemIds.length}</span>
          ) : null}
        </div>
      }
      secondaryText="Zrušit"
      onSecondary={() => props.onOpenChange(false)}
      primaryText={saving ? "Vkládám…" : "Vložit do akce"}
      onPrimary={submit}
      primaryDisabled={saving || loading || changes.length === 0 || invalidItemIds.length > 0}
    >
      <div className="flex h-full min-h-0 flex-col bg-slate-50/70">
        <div className="border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">Hledat položku</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Hledat název nebo kategorii…"
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><strong className="text-slate-900">{items.length}</strong> položek</span>
              <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">Enter</kbd> další řádek</span>
              <span className="hidden md:inline">Dostupnost platí pro termín akce</span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          {loading ? (
            <div className="columns-1 gap-3 md:columns-2 xl:columns-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="mb-3 break-inside-avoid rounded-xl border border-slate-200 bg-white p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-3 h-24 w-full" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Položky se nepodařilo načíst: {loadError}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
              Pro hledaný výraz nejsou žádné položky.
            </div>
          ) : (
            <div className="columns-1 gap-3 md:columns-2 lg:columns-3 xl:columns-4">
              {groups.map((group) => (
                <section
                  key={group.key}
                  className="mb-3 break-inside-avoid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-100"
                >
                  <div className="border-b border-slate-200 bg-slate-100/80 px-2.5 py-2">
                    <h3 className="truncate text-xs font-bold text-slate-800" title={group.title}>
                      {group.title}
                    </h3>
                  </div>
                  <table className="w-full table-fixed border-collapse text-xs">
                    <colgroup>
                      <col />
                      <col className="w-16" />
                      <col className="w-20" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="px-2.5 py-1.5 text-left font-semibold">Položka</th>
                        <th className="px-1 py-1.5 text-right font-semibold">Volné</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Chci</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const existing = existingByItemId.get(item.itemId);
                        const editable = canModifyExistingItem(props.role, currentUserId, existing);
                        const available = availability.get(item.itemId)?.available ?? 0;
                        const rawQuantity = quantities[item.itemId] ?? "";
                        const requestedQuantity = parseQuantity(rawQuantity);
                        const effective = requestedQuantity === null ? null : effectiveQuantity(item, requestedQuantity);
                        const originalQuantity = existing?.reservedQuantity ?? 0;
                        const changed = requestedQuantity !== null && requestedQuantity !== originalQuantity;
                        const invalid = invalidItemIds.includes(item.itemId);
                        const unavailable = available <= 0 && originalQuantity <= 0;
                        const packageAdjusted =
                          requestedQuantity !== null && requestedQuantity > 0 && effective !== requestedQuantity;

                        return (
                          <tr
                            key={item.itemId}
                            className={cn(
                              "border-b border-slate-100 last:border-b-0",
                              changed && !invalid && "bg-indigo-50/70",
                              invalid && "bg-red-50",
                              submitErrorItemId === item.itemId && "ring-2 ring-inset ring-red-400"
                            )}
                          >
                            <td className="px-2.5 py-1.5 align-middle">
                              <div className="truncate font-medium text-slate-800" title={item.name}>{item.name}</div>
                              {packageAdjusted ? (
                                <div className="truncate text-[10px] font-semibold text-blue-700">
                                  celé balení → {effective} {item.unit ?? "ks"}
                                </div>
                              ) : !editable ? (
                                <div className="truncate text-[10px] text-slate-500">spravuje jiná role</div>
                              ) : null}
                            </td>
                            <td
                              className={cn(
                                "px-1 py-1.5 text-right align-middle font-semibold tabular-nums",
                                available > 3 && "text-emerald-700",
                                available > 0 && available <= 3 && "text-amber-700",
                                available <= 0 && "text-red-600"
                              )}
                            >
                              {available}
                              <span className="ml-0.5 text-[9px] font-normal text-slate-400">{item.unit ?? "ks"}</span>
                            </td>
                            <td className="px-2 py-1 align-middle">
                              <label className="sr-only" htmlFor={`quick-qty-${item.itemId}`}>
                                Požadované množství: {item.name}
                              </label>
                              <input
                                ref={(element) => {
                                  if (element) inputRefs.current.set(item.itemId, element);
                                  else inputRefs.current.delete(item.itemId);
                                }}
                                id={`quick-qty-${item.itemId}`}
                                name={`quantity-${item.itemId}`}
                                className={cn(
                                  "h-8 w-full rounded-lg border bg-white px-1.5 text-right text-sm font-semibold tabular-nums outline-none transition focus:ring-2",
                                  invalid
                                    ? "border-red-400 text-red-800 ring-red-300"
                                    : "border-slate-200 text-slate-900 focus:border-indigo-400 focus:ring-indigo-200",
                                  (unavailable || !editable) && "bg-slate-100 text-slate-400"
                                )}
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                max={available}
                                value={rawQuantity}
                                placeholder="0"
                                disabled={unavailable || !editable || saving}
                                onFocus={(event) => event.target.select()}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setQuantities((current) => ({ ...current, [item.itemId]: value }));
                                  setSubmitErrorItemId((current) => current === item.itemId ? null : current);
                                }}
                                onKeyDown={(event) => handleQuantityKeyDown(event, item.itemId)}
                                aria-invalid={invalid}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
