import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { ChevronRight, Plus, Search } from "lucide-react";
import { api, getCurrentUser } from "../lib/api";
import { humanError } from "../lib/viewModel";
import { cn } from "../lib/ui";
import { dayRangeLabel, eventDayDateLabel, type DayRange } from "../lib/eventDays";
import { FavoriteFilter, useInventoryFavorites } from "./InventoryFavorites";
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
  sku?: string | null;
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

const MAX_ROWS_PER_CARD = 16;

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
  eventName: string;
  eventDate: string | null;
  dayCount: number;
  warehouseName?: string;
  role: string;
  existingItems: QuickAddExistingItem[];
  range: DayRange;
  initialFavoritesOnly: boolean;
  onDone: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<QuickInventoryItem[]>([]);
  const [availability, setAvailability] = useState<Map<string, AvailabilityRow>>(new Map());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState("");
  const [filledOnly, setFilledOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useInventoryFavorites();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitErrorItemId, setSubmitErrorItemId] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const searchContainer = useRef<HTMLLabelElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const currentUserId = getCurrentUser()?.id;

  const existingByItemId = useMemo(
    () => new Map(props.existingItems.map((item) => [item.inventoryItemId, item])),
    [props.existingItems]
  );

  useEffect(() => {
    if (props.open) setFavoritesOnly(props.initialFavoritesOnly);
  }, [props.open, props.initialFavoritesOnly]);

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
    setParentId("");
    setFilledOnly(false);
    setActiveItemId(null);
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

        const ids = inventoryResponse.items.map((item) => item.itemId);
        const batches = Array.from({ length: Math.ceil(ids.length / 1000) }, (_, index) =>
          api<{ rows: AvailabilityRow[] }>(`/events/${props.eventId}/availability`, {
            method: "POST",
            body: JSON.stringify({
              inventory_item_ids: ids.slice(index * 1000, (index + 1) * 1000),
              day_from: props.range.dayFrom,
              day_to: props.range.dayTo
            })
          })
        );
        const responses = await Promise.all(batches);
        if (sequence !== loadSequence.current) return;
        setAvailability(
          new Map(responses.flatMap(({ rows }) => rows.map((row) => [row.inventoryItemId, row] as const)))
        );
      })
      .catch((error: unknown) => {
        if (sequence !== loadSequence.current) return;
        setLoadError(humanError(error));
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
    return () => { ++loadSequence.current; };
  }, [props.open, props.eventId, props.existingItems, props.range.dayFrom, props.range.dayTo]);

  const parentCategories = useMemo(() => {
    const categories = new Map<string, { ref: CategoryRef; count: number }>();
    for (const { category: { parent } } of items) {
      const category = categories.get(parent.id) ?? { ref: parent, count: 0 };
      category.count += 1;
      categories.set(parent.id, category);
    }
    return [...categories.values()].sort((a, b) =>
      (a.ref.sortOrder ?? 0) - (b.ref.sortOrder ?? 0) || a.ref.name.localeCompare(b.ref.name, "cs"));
  }, [items]);

  const visibleItems = useMemo(() => {
    const tokens = normalizeSearchText(search.trim()).split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      if (favoritesOnly && !favorites?.ids?.has(item.itemId)) return false;
      if (parentId && item.category.parent.id !== parentId) return false;
      if (filledOnly && !quantities[item.itemId]?.trim() && activeItemId !== item.itemId) return false;
      if (tokens.length === 0) return true;
      const categoryLabel = `${item.category.parent.name} ${item.category.sub?.name ?? ""}`;
      const haystack = normalizeSearchText(`${item.name} ${categoryLabel} ${item.sku ?? ""}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [items, search, parentId, filledOnly, favoritesOnly, favorites?.ids, quantities, activeItemId]);

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
    return [...groupsByKey.values()].flatMap((group) =>
      Array.from({ length: Math.ceil(group.items.length / MAX_ROWS_PER_CARD) }, (_, index) => ({
        key: `${group.key}:${index}`,
        title: group.title,
        items: group.items.slice(index * MAX_ROWS_PER_CARD, (index + 1) * MAX_ROWS_PER_CARD)
      }))
    );
  }, [visibleItems]);
  const inputOrder = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const changes = useMemo(() => {
    return items.flatMap((item) => {
      const existing = existingByItemId.get(item.itemId);
      if (!canModifyExistingItem(props.role, currentUserId, existing)) return [];

      const requestedQuantity = parseQuantity(quantities[item.itemId] ?? "");
      const originalQuantity = existing?.reservedQuantity ?? 0;
      if (requestedQuantity === null || requestedQuantity === originalQuantity) return [];

      return [{ item, requestedQuantity }];
    });
  }, [currentUserId, existingByItemId, items, props.role, quantities]);

  const invalidItemIds = useMemo(() => {
    return new Set(items.flatMap((item) => {
      const existing = existingByItemId.get(item.itemId);
      if (!canModifyExistingItem(props.role, currentUserId, existing)) return [];

      const requestedQuantity = parseQuantity(quantities[item.itemId] ?? "");
      if (requestedQuantity === null) return [item.itemId];
      if (requestedQuantity === 0 || requestedQuantity === (existing?.reservedQuantity ?? 0)) return [];

      const available = availability.get(item.itemId)?.available ?? 0;
      return effectiveQuantity(item, requestedQuantity) > available ? [item.itemId] : [];
    }));
  }, [availability, currentUserId, existingByItemId, items, props.role, quantities]);

  const totals = new Map<string, number>();
  let filledCount = 0;
  for (const item of items) {
    const quantity = parseQuantity(quantities[item.itemId] ?? "") ?? 0;
    if (quantity === 0) continue;
    filledCount += 1;
    const unit = item.unit ?? "ks";
    totals.set(unit, (totals.get(unit) ?? 0) + quantity);
  }

  const focusAdjacentInput = (itemId: string, direction: 1 | -1) => {
    const currentIndex = inputOrder.findIndex((item) => item.itemId === itemId);
    if (currentIndex < 0) return;
    for (
      let index = currentIndex + direction;
      index >= 0 && index < inputOrder.length;
      index += direction
    ) {
      const input = inputRefs.current.get(inputOrder[index].itemId);
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
    if (saving || loading || loadError || changes.length === 0 || invalidItemIds.size > 0) return;
    setSaving(true);
    setSubmitErrorItemId(null);
    try {
      const response = await api<ReserveResponse>(`/events/${props.eventId}/reserve`, {
        method: "POST",
        body: JSON.stringify({
          items: changes.map((change) => ({
            inventory_item_id: change.item.itemId,
            qty: change.requestedQuantity,
            day_from: props.range.dayFrom,
            day_to: props.range.dayTo
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
        setParentId("");
        setFilledOnly(false);
        setFavoritesOnly(false);
        window.requestAnimationFrame(() => inputRefs.current.get(itemId)?.focus());
      }
      toast.error(humanError(error));
    } finally {
      setSaving(false);
    }
  };

  const description = [
    `Přidáváte do akce ${props.eventName}`,
    props.eventDate ? eventDayDateLabel(props.eventDate, props.range.dayFrom) : null,
    props.dayCount > 1 ? dayRangeLabel(props.range, props.dayCount) : null,
    props.warehouseName,
    "dostupnost pro termín akce"
  ].filter(Boolean).join(" · ");

  return (
    <Modal
      open={props.open}
      onOpenChange={(open) => { if (!saving) props.onOpenChange(open); }}
      fullScreen
      title="Rychlé zadání položek"
      description={description}
      contentClassName="border-0 md:top-0"
      headerClassName="items-center border-b-0 px-4 pb-2 pt-4 sm:px-6 [&_h2]:text-xl [&_h2]:font-bold [&_button]:border [&_button]:border-line"
      headerAside={
        <span className="hidden text-xs text-muted sm:inline">
          <kbd className="mr-1 rounded-md border border-line bg-canvas px-1.5 py-0.5">Enter</kbd> další řádek
        </span>
      }
      onOpenAutoFocus={(event) => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const input = searchContainer.current?.querySelector("input");
        if (!input || !window.matchMedia("(pointer: fine)").matches) return;
        event.preventDefault();
        input.focus();
      }}
      onCloseAutoFocus={(event) => {
        if (!opener.current?.isConnected) return;
        event.preventDefault();
        opener.current.focus();
      }}
      bodyClassName="flex flex-col overflow-hidden"
      footer={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0 text-sm">
          <strong>Vyplněno {filledCount} položek</strong>
          {totals.size > 0 && (
            <span className="text-muted">
              {[...totals].map(([unit, total]) => `${total.toLocaleString("cs-CZ")} ${unit}`).join(" · ")} celkem
            </span>
          )}
          {filledCount > 0 && !filledOnly && (
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
              onClick={() => {
                setSearch("");
                setParentId("");
                setFilledOnly(true);
                setFavoritesOnly(false);
              }}
            >
              Zobrazit vyplněné <ChevronRight size={14} />
            </button>
          )}
          {invalidItemIds.size > 0 && (
            <span role="status" className="font-semibold text-red-700">K opravě {invalidItemIds.size}</span>
          )}
        </div>
      }
      secondaryText="Zrušit"
      onSecondary={() => { if (!saving) props.onOpenChange(false); }}
      primaryText={saving ? "Vkládám…" : <><Plus size={16} /> Vložit do akce ({changes.length})</>}
      onPrimary={submit}
      primaryDisabled={saving || loading || !!loadError || changes.length === 0 || invalidItemIds.size > 0}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 pb-3 pt-1 sm:px-6">
        <label ref={searchContainer} className="relative w-full min-w-52 flex-1 xl:max-w-[30.5%]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            aria-label="Hledat položku"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Hledat název nebo kategorii…"
          />
        </label>
        <FavoriteFilter selected={favoritesOnly} onChange={setFavoritesOnly} />
        <div role="group" aria-label="Kategorie položek" className="order-last flex min-w-0 basis-full gap-1.5 overflow-x-auto py-0.5 xl:order-none xl:flex-1">
          {[{ ref: { id: "", name: "Vše" }, count: items.length }, ...parentCategories].map(({ ref, count }) => (
            <button
              type="button"
              key={ref.id}
              aria-pressed={parentId === ref.id}
              onClick={() => setParentId(ref.id)}
              className={cn(
                "shrink-0 rounded-full border border-line px-3 py-1 text-[13px] font-medium whitespace-nowrap focus-visible:outline-offset-[-2px]",
                parentId === ref.id ? "border-ink bg-ink text-white" : "bg-white hover:bg-canvas"
              )}
            >
              {ref.name} {count}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={filledOnly}
          className="group inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg text-[13px]"
          onClick={() => setFilledOnly((current) => !current)}
        >
          <span aria-hidden="true" className="relative h-[18px] w-8 rounded-full bg-line after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-white after:transition-transform group-aria-checked:bg-indigo-600 group-aria-checked:after:translate-x-3.5" />
          Jen vyplněné
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-canvas px-4 py-5 sm:px-6">
        {loading ? (
          <div className="columns-1 gap-4 md:columns-2 xl:columns-4" role="status" aria-label="Načítám položky">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="mb-4 break-inside-avoid rounded-xl border border-line bg-white p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-3 h-24 w-full" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Položky se nepodařilo načíst. {loadError}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-6 text-center text-sm text-muted">
            {favoritesOnly && favorites?.ids?.size === 0 ? "Zatím nemáte žádné oblíbené položky." : "Žádné položky pro vybrané filtry."}
          </div>
        ) : (
          <div className="columns-1 gap-4 md:columns-2 lg:columns-3 xl:columns-4">
            {groups.map((group) => (
              <section key={group.key} className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-line bg-white">
                <table aria-label={group.title} className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col />
                    <col className="w-[5.25rem]" />
                    <col className="w-[5.25rem]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-line bg-table">
                      <th scope="col" className="px-3 py-2 text-left text-[13px] font-bold leading-tight">{group.title}</th>
                      <th scope="col" className="px-1 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted">Dostupné</th>
                      <th scope="col" className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">Chci</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => {
                      const existing = existingByItemId.get(item.itemId);
                      const editable = canModifyExistingItem(props.role, currentUserId, existing);
                      const available = availability.get(item.itemId)?.available ?? 0;
                      const rawQuantity = quantities[item.itemId] ?? "";
                      const requested = parseQuantity(rawQuantity);
                      const effective = requested === null ? null : effectiveQuantity(item, requested);
                      const filled = requested !== null && requested > 0;
                      const invalid = invalidItemIds.has(item.itemId) || submitErrorItemId === item.itemId;
                      const unavailable = available <= 0 && !existing?.reservedQuantity && !rawQuantity;
                      const packageAdjusted = filled && effective !== requested;
                      const unit = item.unit ?? "ks";

                      return (
                        <tr
                          key={item.itemId}
                          className={cn(
                            "border-b border-line last:border-b-0",
                            filled && "bg-indigo-50",
                            invalid && "bg-red-50"
                          )}
                        >
                          <th scope="row" className={cn(
                            "px-3 py-1.5 text-left align-middle font-normal leading-tight wrap-break-word",
                            filled && "font-semibold",
                            unavailable && "text-muted"
                          )}>
                            {item.name}
                            {packageAdjusted ? (
                              <span className="mt-0.5 block text-[11px] font-medium text-indigo-700">Celé balení {effective} {unit}</span>
                            ) : !editable ? (
                              <span className="mt-0.5 block text-[11px] text-muted">Spravuje jiný uživatel</span>
                            ) : null}
                          </th>
                          <td className={cn(
                            "px-1 py-1.5 text-right align-middle text-[13px] font-semibold tabular-nums",
                            available <= 0 ? "text-red-700" : available <= 20 ? "text-amber-800" : "text-emerald-700"
                          )}>
                            {available.toLocaleString("cs-CZ")} {unit}
                          </td>
                          <td className="px-2.5 py-1 align-middle">
                            <input
                              ref={(element) => {
                                if (element) inputRefs.current.set(item.itemId, element);
                                else inputRefs.current.delete(item.itemId);
                              }}
                              aria-label={`Požadované množství: ${item.name}`}
                              aria-invalid={invalid}
                              className={cn(
                                "h-8 w-full rounded-lg border border-line bg-white px-1 text-center text-sm font-semibold tabular-nums outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 [&::-webkit-inner-spin-button]:appearance-none [appearance:textfield]",
                                filled && "border-indigo-600 text-indigo-700 ring-1 ring-inset ring-indigo-600",
                                (unavailable || !editable) && "bg-canvas text-muted",
                                invalid && "border-red-600 text-red-700 ring-1 ring-inset ring-red-600"
                              )}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              max={Math.max(0, available)}
                              value={rawQuantity}
                              placeholder={unavailable ? "–" : undefined}
                              disabled={unavailable || !editable || saving}
                              onFocus={(event) => {
                                setActiveItemId(item.itemId);
                                event.currentTarget.select();
                              }}
                              onBlur={() => setActiveItemId((current) => current === item.itemId ? null : current)}
                              onChange={(event) => {
                                const value = event.target.value;
                                setQuantities((current) => ({ ...current, [item.itemId]: value }));
                                setSubmitErrorItemId((current) => current === item.itemId ? null : current);
                              }}
                              onKeyDown={(event) => handleQuantityKeyDown(event, item.itemId)}
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
    </Modal>
  );
}
