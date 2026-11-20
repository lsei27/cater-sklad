import { Check, Lock, MapPin, PackageCheck, ScanLine, X } from "lucide-react";
import { useState } from "react";
import { apiUrl } from "../lib/api";
import { Icons } from "../lib/icons";
import { cn } from "../lib/ui";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { Card } from "./ui/Card";
import Input from "./ui/Input";
import QuantityStepper from "./ui/QuantityStepper";
import SegmentedControl from "./ui/SegmentedControl";

type PackingRow = {
  inventory_item_id: string;
  name: string;
  unit: string;
  requested: number;
  total?: number;
  parentCategory?: string;
  category?: string;
  warehouseName?: string | null;
  imageUrl?: string | null;
};
type Block = { id: string; inventoryItemId: string; blockedQuantity: number; blockedUntil: string; note?: string };
export type PackingState = "idle" | "armed" | "confirmed";
export type DigitalPackingItem = { state: PackingState; packedQuantity: number | null };
type PackingMode =
  | { kind: "digital"; items: Record<string, DigitalPackingItem>; saving: Set<string>; onUpdate: (id: string, state: PackingState, quantity: number) => void }
  | { kind: "manual"; quantities: ReadonlyMap<string, number>; qrCodes: ReadonlyMap<string, string>; onQuantityChange: (row: PackingRow, quantity: number) => void };

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("cs");
}

export default function WarehousePackingTable({
  rows,
  mode,
  disabled,
  codes,
  changes,
  blocks,
  onBlock,
  onRemoveBlock,
}: {
  rows: PackingRow[];
  mode: PackingMode;
  disabled: boolean;
  codes: Map<string, string>;
  changes: Map<string, { added: boolean; from?: number }>;
  blocks: Block[];
  onBlock: (row: PackingRow) => void;
  onRemoveBlock: (block: Block) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"pending" | "done" | "missing" | "all">("all");
  const [byWarehouse, setByWarehouse] = useState(true);
  const [digitalDrafts, setDigitalDrafts] = useState(new Map<string, number>());
  const manual = mode.kind === "manual";
  const issuedQuantity = (row: PackingRow) => {
    const id = row.inventory_item_id;
    if (mode.kind === "manual") return mode.quantities.get(id) ?? row.requested;
    const item = mode.items[id];
    const quantity = item?.state === "confirmed" ? item.packedQuantity : digitalDrafts.get(id) ?? item?.packedQuantity;
    return Math.min(row.requested, quantity ?? row.requested);
  };
  const isCompleted = (row: PackingRow) => mode.kind === "manual"
    ? issuedQuantity(row) === row.requested
    : mode.items[row.inventory_item_id]?.state === "confirmed";
  const completed = rows.filter(isCompleted).length;
  const shortage = (row: PackingRow) => manual
    ? issuedQuantity(row) < row.requested
    : isCompleted(row) ? issuedQuantity(row) < row.requested : row.total !== undefined && row.total < row.requested;
  const missing = rows.filter(shortage).length;
  const percentage = rows.length ? Math.round((100 * completed) / rows.length) : 0;
  const term = normalizeSearch(search);
  const groups = new Map<string, PackingRow[]>();
  for (const row of rows) {
    const checked = isCompleted(row);
    if (
      (filter === "done" && !checked) ||
      (filter === "pending" && checked) ||
      (filter === "missing" && !shortage(row))
    )
      continue;
    if (
      term &&
      ![row.name, row.inventory_item_id, codes.get(row.inventory_item_id), mode.kind === "manual" ? mode.qrCodes.get(row.inventory_item_id) : undefined]
        .some((value) => value && normalizeSearch(value).includes(term))
    )
      continue;
    const key = byWarehouse ? row.warehouseName || "Sklad neurčen" : row.parentCategory || "Ostatní";
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "cs"));

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className={cn("min-w-40 flex-1", manual && "max-sm:basis-full")}>
          <div className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
            <span>
              {completed} z {rows.length} položek {manual ? `vydáno podle checklistu · Výjimky ${missing}` : "potvrzeno"}
            </span>
          <span className="whitespace-nowrap text-indigo-700">{percentage} %</span>
          </div>
          <progress
            value={completed}
            max={Math.max(rows.length, 1)}
            aria-label={manual ? "Položky vydané podle checklistu" : "Potvrzené položky"}
            className="block h-2 w-full overflow-hidden rounded-full bg-canvas accent-indigo-600 [&::-webkit-progress-bar]:bg-canvas [&::-webkit-progress-value]:bg-indigo-600"
          />
        </div>
        <dl className="flex shrink-0 items-center gap-4 text-xs text-muted sm:border-l sm:border-line sm:pl-4">
          <div>
            <dt>Hotovo</dt>
            <dd className="text-lg font-bold leading-6 text-emerald-700">{completed}</dd>
          </div>
          <div>
            <dt>Zbývá</dt>
            <dd className="text-lg font-bold leading-6 text-ink">{manual ? 0 : rows.length - completed}</dd>
          </div>
          <div>
            <dt>Chybí</dt>
            <dd className="text-lg font-bold leading-6 text-red-700">{missing}</dd>
          </div>
        </dl>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full min-w-44 flex-1">
          <ScanLine
            size={17}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-indigo-700"
          />
          <Input
            type="search"
            aria-label="Hledat ve vychystávání"
            className="pl-9"
            placeholder={manual ? "Zapsat výjimku: kód nebo název položky…" : "Naskenujte kód nebo napište název položky…"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <SegmentedControl
          label="Stav vychystání"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: manual ? `Výjimky ${missing}` : `Zbývá ${rows.length - completed}` },
            { value: "done", label: manual ? `Podle checklistu ${completed}` : `Hotovo ${completed}` },
            { value: "missing", label: <span className="text-red-700">Chybí {missing}</span> },
            { value: "all", label: "Vše" },
          ]}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => setByWarehouse(!byWarehouse)}
          aria-pressed={byWarehouse}
        >
          <MapPin size={16} /> {manual
            ? `Seskupit: podle ${byWarehouse ? "umístění" : "kategorie"}`
            : byWarehouse ? "Podle umístění" : "Podle kategorie"}
        </Button>
      </div>
      <Card className="overflow-x-auto">
        <table className={cn("work-table w-full text-sm sm:min-w-[565px]", manual && "lg:table-fixed")}>
          {manual && (
            <colgroup className="max-lg:hidden">
              <col />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
            </colgroup>
          )}
          <thead className="table-header max-sm:sr-only">
            <tr>
              <th scope="col">Položka</th>
              <th scope="col">Umístění</th>
              <th scope="col">Požadováno</th>
              <th scope="col">{manual ? "Vydáno" : "Vychystáno"}</th>
              <th scope="col">Stav</th>
            </tr>
          </thead>
          {sorted.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted">
                  Výběru neodpovídají žádné položky.
                </td>
              </tr>
            </tbody>
          )}
          {sorted.map(([label, group]) => (
            <tbody key={label} className="divide-y divide-line border-t border-line">
              <tr className="bg-table">
                <th scope="rowgroup" colSpan={5} className="px-4 py-2 text-left text-xs font-semibold text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={14} /> {label} · {group.length} pol.
                  </span>
                </th>
              </tr>
              {group.map((row) => {
                const id = row.inventory_item_id;
                const state = mode.kind === "digital" ? mode.items[id]?.state ?? "idle" : null;
                const checked = isCompleted(row);
                const issued = issuedQuantity(row);
                const short = shortage(row);
                const quantityLabel = manual ? "Vydáno" : "Vychystáno";
                const rowDisabled = disabled || (mode.kind === "digital" && mode.saving.has(id));
                const updateQuantity = (value: number) => {
                  if (mode.kind === "manual") {
                    mode.onQuantityChange(row, value);
                  } else if (Number.isFinite(value)) {
                    setDigitalDrafts((previous) => new Map(previous).set(id, Math.min(row.requested, Math.max(0, Math.trunc(value)))));
                  }
                };
                const packingStatus = issued === row.requested ? "Hotovo" : issued === 0 ? "Nevydáno · chybí" : `Částečně · chybí ${row.requested - issued} ${row.unit}`;
                const itemChange = changes.get(id);
                const relatedBlocks = blocks.filter((block) => block.inventoryItemId === id);
                const code = codes.get(id);
                return (
                  <tr key={id} className={cn("packing-line", short ? "bg-red-50/60" : itemChange && "bg-amber-50/70")}>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {mode.kind === "manual" ? (
                          <label className="relative grid size-8 shrink-0 cursor-pointer place-items-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              aria-label={`Vydáno podle checklistu: ${row.name}`}
                              className={cn("size-[22px] cursor-pointer appearance-none rounded-md border bg-white checked:border-emerald-700 checked:bg-emerald-700", checked ? "border-emerald-700" : "border-red-700")}
                              onChange={(event) => mode.onQuantityChange(row, event.currentTarget.checked ? row.requested : 0)}
                            />
                            {checked && <Check size={15} aria-hidden="true" className="pointer-events-none absolute text-white" />}
                          </label>
                        ) : checked && <Check size={16} className="shrink-0 text-emerald-700" aria-label="Vychystáno" />}
                        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">
                          {row.imageUrl ? (
                            <img loading="lazy" className="size-full object-cover" src={apiUrl(row.imageUrl)} alt="" />
                          ) : (
                            <Icons.Image className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium wrap-break-word">{row.name}</div>
                          {code && <span className="font-mono text-xs text-muted">{code}</span>}
                          {itemChange && (
                            <Badge className="ml-2" tone={itemChange.added ? "ok" : "warn"}>
                              {itemChange.added ? "Nové" : `Změna z ${itemChange.from}`}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {relatedBlocks.map((block) => (
                        <div key={block.id} className="mt-1 flex items-center gap-1 text-xs text-indigo-700">
                          {block.blockedQuantity} {row.unit} blokováno do{" "}
                          {new Date(block.blockedUntil).toLocaleDateString("cs-CZ")}
                          {block.note ? ` · ${block.note}` : ""}
                          <button
                            type="button"
                            aria-label="Zrušit blokaci"
                            className="rounded p-1 hover:bg-red-100 hover:text-red-700"
                            onClick={() => onRemoveBlock(block)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {manual && row.warehouseName ? <Badge>{row.warehouseName}</Badge> : row.warehouseName || "–"}
                      {row.category && <div>{row.category}</div>}
                      {manual && row.total !== undefined && row.total < row.requested && (
                        <Badge tone="warn" className="mt-1">Skladem {row.total} {row.unit}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums whitespace-nowrap">
                      <span className="mb-0.5 block text-xs font-normal text-muted sm:hidden">Požadováno</span>
                      {row.requested} {row.unit}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                      <span className="mb-0.5 block text-xs font-normal text-muted sm:hidden">{quantityLabel}</span>
                      {manual || !checked ? (
                        <QuantityStepper
                          label={`${quantityLabel} – ${row.name}`}
                          className={cn("w-[116px] sm:w-[104px] [&>button]:size-9 sm:[&>button]:size-7 [&>span]:min-w-0 [&>span]:flex-1", short && "text-red-700")}
                          value={
                            <input
                              aria-label={`${quantityLabel}: ${row.name}`}
                              className="w-full rounded-sm bg-transparent text-center [appearance:textfield] focus-visible:outline-offset-0 [&::-webkit-inner-spin-button]:appearance-none"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={row.requested}
                              step={1}
                              value={issued}
                              disabled={rowDisabled}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => updateQuantity(Number(event.currentTarget.value))}
                            />
                          }
                          onDecrease={() => updateQuantity(issued - 1)}
                          onIncrease={() => updateQuantity(issued + 1)}
                          decreaseDisabled={rowDisabled || issued <= 0}
                          increaseDisabled={rowDisabled || issued >= row.requested}
                        />
                      ) : `${issued} ${row.unit}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className={cn("flex items-center gap-1.5", manual ? "justify-between" : "flex-wrap")}>
                        {mode.kind === "manual" ? (
                          <Badge tone={short ? "danger" : "neutral"}>
                            {checked ? "Podle checklistu" : issued === 0 ? "Nevydáno · chybí" : `Vydáno částečně · chybí ${row.requested - issued} ${row.unit}`}
                          </Badge>
                        ) : checked ? (
                          <>
                            <Badge tone={short ? "danger" : "ok"}>{packingStatus}</Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={rowDisabled}
                              onClick={() => mode.onUpdate(id, "idle", issued)}
                            >
                              Vrátit do seznamu
                            </Button>
                          </>
                        ) : state === "armed" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={rowDisabled}
                              onClick={() => mode.onUpdate(id, "confirmed", issued)}
                            >
                              <Check size={14} /> Potvrdit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={rowDisabled}
                              onClick={() => mode.onUpdate(id, "idle", issued)}
                            >
                              Zrušit
                            </Button>
                          </>
                        ) : (
                          <>
                            {short && <Badge tone="danger">Nedostatek skladem</Badge>}
                            <Button
                              size="sm"
                              variant="dark"
                              disabled={rowDisabled}
                              onClick={() => mode.onUpdate(id, "armed", issued)}
                            >
                              <PackageCheck size={14} /> Vychystat
                            </Button>
                          </>
                        )}
                        {manual ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Manuální blokace: ${row.name}`}
                            title="Manuální blokace"
                            className="size-9 shrink-0 p-0 text-indigo-700 sm:size-7"
                            onClick={() => onBlock(row)}
                          >
                            <Lock size={14} />
                          </Button>
                        ) : !checked && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-indigo-700"
                            onClick={() => onBlock(row)}
                          >
                            Blokace
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </Card>
    </div>
  );
}
