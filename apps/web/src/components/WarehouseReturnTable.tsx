import { Check, ChevronDown, Lock, ScanLine, Tag, Warehouse, X } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { apiUrl } from "../lib/api";
import { Icons } from "../lib/icons";
import { cn } from "../lib/ui";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { Card } from "./ui/Card";
import Input from "./ui/Input";
import QuantityStepper from "./ui/QuantityStepper";
import SegmentedControl from "./ui/SegmentedControl";

type WarehouseOption = { id: string; name: string };
type Block = { id: string; inventoryItemId: string; blockedQuantity: number; blockedUntil: string; note?: string };
type QuantityField = "returned" | "broken";
type ReturnFilter = "unchecked" | "difference" | "ok" | "all";

type ReturnRow = {
  inventory_item_id: string;
  name: string;
  unit: string;
  requested: number;
  issued: number;
  returned: number;
  broken: number;
  consumable: boolean;
  parentCategory?: string;
  category?: string;
  imageUrl?: string | null;
  target_warehouse_id?: string;
};

const wholeNumber = new Intl.NumberFormat("cs-CZ");

function formatTotals(totals: Map<string, number>) {
  const quantities = [...totals].filter(([, quantity]) => quantity > 0);
  if (quantities.length <= 1) return wholeNumber.format(quantities[0]?.[1] ?? 0);
  return quantities.map(([unit, quantity]) => `${wholeNumber.format(quantity)} ${unit}`).join(" · ");
}

function addQuantity(totals: Map<string, number>, unit: string, quantity: number) {
  totals.set(unit, (totals.get(unit) ?? 0) + quantity);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("cs");
}

function ReturnQuantity({
  name, label, value, max, highlighted, onChange
}: {
  name: string;
  label: string;
  value: number;
  max: number;
  highlighted?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <QuantityStepper
      label={`${label} – ${name}`}
      className={cn(
        "w-[104px] [&>button]:w-7 [&>span]:min-w-0 [&>span]:flex-1",
        highlighted && "border-amber-700 bg-amber-100/50 text-amber-800"
      )}
      value={
        <input
          aria-label={`${label}: ${name}`}
          className="w-full rounded-sm bg-transparent text-center [appearance:textfield] focus-visible:outline-offset-0 [&::-webkit-inner-spin-button]:appearance-none"
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onChange(Math.trunc(Number(event.target.value)))}
        />
      }
      onDecrease={() => onChange(value - 1)}
      onIncrease={() => onChange(value + 1)}
      decreaseDisabled={value <= 0}
      increaseDisabled={value >= max}
    />
  );
}

export default function WarehouseReturnTable({
  rows, checkedIds, onChecked, codes, warehouses, preferredWarehouseId, onWarehouseChange,
  onQuantityChange, onClose, closeDisabled, blocks, onBlock, onRemoveBlock
}: {
  rows: ReturnRow[];
  checkedIds: Set<string>;
  onChecked: (id: string, checked: boolean) => void;
  codes: Map<string, string>;
  warehouses: WarehouseOption[];
  preferredWarehouseId: string | undefined;
  onWarehouseChange: (value: string | undefined, itemId?: string) => void;
  onQuantityChange: (id: string, field: QuantityField, value: number) => void;
  onClose: () => void;
  closeDisabled: boolean;
  blocks: Block[];
  onBlock: (row: ReturnRow) => void;
  onRemoveBlock: (block: Block) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReturnFilter>("all");
  const term = normalize(search);
  const groups = new Map<string, Array<ReturnRow & { checked: boolean; missing: number; consumed: number }>>();
  const brokenTotals = new Map<string, number>();
  const consumedTotals = new Map<string, number>();
  const missingTotals = new Map<string, number>();
  const returnedByUnit = new Map<string, { returned: number; issued: number }>();
  let checkedCount = 0;
  let differences = 0;
  let ok = 0;

  for (const row of rows) {
    const rowId = row.inventory_item_id;
    const checked = checkedIds.has(rowId);
    const shortfall = Math.max(0, row.issued - row.returned - row.broken);
    const missing = row.consumable ? 0 : shortfall;
    const consumed = row.consumable ? shortfall : 0;
    const hasDifference = missing > 0 || row.broken > 0;
    if (checked) checkedCount += 1;
    if (hasDifference) differences += 1;
    if (checked && !hasDifference) ok += 1;
    addQuantity(brokenTotals, row.unit, row.broken);
    addQuantity(consumedTotals, row.unit, consumed);
    addQuantity(missingTotals, row.unit, missing);
    if (!row.consumable) {
      const total = returnedByUnit.get(row.unit) ?? { returned: 0, issued: 0 };
      total.returned += row.returned;
      total.issued += row.issued;
      returnedByUnit.set(row.unit, total);
    }
    if (
      (filter === "unchecked" && checked) ||
      (filter === "difference" && !hasDifference) ||
      (filter === "ok" && (!checked || hasDifference)) ||
      (term && ![row.name, rowId, codes.get(rowId) ?? ""].some((value) => normalize(value).includes(term)))
    ) continue;
    const label = [row.parentCategory, row.category].filter(Boolean).join(" / ") || "Ostatní";
    const group = groups.get(label) ?? [];
    group.push({ ...row, checked, missing, consumed });
    groups.set(label, group);
  }

  const percentage = rows.length ? Math.round(100 * checkedCount / rows.length) : 0;
  const commonWarehouse = rows[0]?.target_warehouse_id ?? "";
  const warehouseValue = rows.every((row) => (row.target_warehouse_id ?? "") === commonWarehouse) ? commonWarehouse : "mixed";

  const handleScan = () => {
    if (!term) return;
    const matches = rows.filter((row) =>
      [row.inventory_item_id, codes.get(row.inventory_item_id) ?? ""].some((value) => normalize(value) === term)
    );
    if (matches.length !== 1) return;
    onChecked(matches[0].inventory_item_id, true);
    setSearch("");
    toast.success(`Zkontrolováno: ${matches[0].name}`, { id: "return-scan" });
  };

  const labels = ["Položka", "Vydáno", "Vráceno", "Rozbito", "Chybí", "Sklad", "Stav"];
  const mobileLabel = "mb-0.5 block text-xs font-normal text-muted lg:hidden";
  const dataCell = "px-3 py-1.5 lg:py-2";

  return (
    <section aria-label="Kontrola vrácených položek" className="space-y-4">
      <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
        <div className="min-w-48 flex-1">
          <div className="mb-1.5 flex items-start justify-between gap-2 text-sm font-semibold">
            <div>
              {checkedCount} z {rows.length} položek zkontrolováno
              {[...returnedByUnit].map(([unit, total]) => (
                <span key={unit} className="inline-block">
                  <span aria-hidden="true" className="mx-1.5">·</span>
                  vráceno {wholeNumber.format(total.returned)} z {wholeNumber.format(total.issued)} {unit}
                </span>
              ))}
            </div>
            <span className="shrink-0 text-indigo-700">{percentage} %</span>
          </div>
          <progress
            value={checkedCount}
            max={Math.max(rows.length, 1)}
            aria-label="Zkontrolované položky"
            className="block h-2 w-full overflow-hidden rounded-full bg-canvas accent-indigo-600 [&::-webkit-progress-bar]:bg-canvas [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-indigo-600"
          />
        </div>
        <dl className="flex shrink-0 flex-wrap items-center divide-x divide-line text-xs text-muted sm:border-l sm:border-line">
          <div className="pr-4 sm:px-4"><dt>Rozbito</dt><dd className="text-lg font-bold text-amber-800">{formatTotals(brokenTotals)}</dd></div>
          <div className="px-4"><dt>Spotřebováno</dt><dd className="text-lg font-bold text-ink">{formatTotals(consumedTotals)}</dd></div>
          <div className="pl-4"><dt>Chybí</dt><dd className="text-lg font-bold text-red-700">{formatTotals(missingTotals)}</dd></div>
        </dl>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full min-w-56 flex-1">
          <ScanLine size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-indigo-700" />
          <Input
            type="search"
            className="border-indigo-600 pl-9"
            aria-label="Hledat nebo naskenovat vrácenou položku"
            placeholder="Naskenujte vrácenou položku nebo hledejte podle názvu…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") handleScan(); }}
          />
        </label>
        <SegmentedControl
          label="Stav kontroly"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "unchecked", label: `Nezkontrolováno ${rows.length - checkedCount}` },
            { value: "difference", label: `S rozdílem ${differences}` },
            { value: "ok", label: `V pořádku ${ok}` },
            { value: "all", label: `Vše ${rows.length}` },
          ]}
        />
        {warehouses.length > 0 && (
          <label className="relative inline-flex h-10 max-w-full items-center rounded-[9px] border border-line bg-white text-sm font-medium">
            <Warehouse size={16} className="pointer-events-none absolute left-3" />
            <select
              aria-label="Sklad pro vrácení všech položek"
              className="h-full max-w-full appearance-none rounded-[9px] bg-transparent py-1 pl-9 pr-8"
              value={rows.length ? warehouseValue : preferredWarehouseId ?? ""}
              disabled={rows.length === 0}
              onChange={(event) => onWarehouseChange(event.target.value || undefined)}
            >
              {warehouseValue === "mixed" && <option value="mixed" disabled>Vracet do: různé sklady</option>}
              <option value="">Vracet do: výchozí sklad</option>
              {warehouses.map((option) => <option key={option.id} value={option.id}>Vracet do: {option.name}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-muted" />
          </label>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="block w-full table-fixed text-sm lg:table" role="table" aria-label="Vrácení z akce">
          <colgroup className="hidden lg:table-column-group">
            <col />
            <col className="w-[7%]" />
            <col className="w-[126px]" />
            <col className="w-[126px]" />
            <col className="w-[7%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead role="rowgroup" className="sr-only table-header lg:not-sr-only">
            <tr role="row">
              {labels.map((label, index) => <th key={label} scope="col" role="columnheader" className={index === 0 ? "lg:pl-14" : undefined}>{label}</th>)}
            </tr>
          </thead>
          {groups.size === 0 && (
            <tbody className="block lg:table-row-group">
              <tr className="block lg:table-row"><td colSpan={7} className="block px-4 py-6 text-muted lg:table-cell">
                {rows.length ? "Výběru neodpovídají žádné položky." : "Pro tuto akci nejsou žádné vydané položky."}
              </td></tr>
            </tbody>
          )}
          {[...groups].map(([group, groupRows]) => (
            <tbody key={group} role="rowgroup" className="block divide-y divide-line border-t border-line lg:table-row-group">
              <tr role="row" className="block bg-table lg:table-row">
                <th scope="rowgroup" colSpan={7} className="block px-4 py-1.5 text-left text-xs font-semibold text-muted lg:table-cell">
                  <span className="inline-flex items-center gap-2"><Tag size={14} /> {group}</span>
                </th>
              </tr>
              {groupRows.map((row) => {
                const id = row.inventory_item_id;
                const hasDifference = row.broken > 0 || row.missing > 0;
                const relatedBlocks = blocks.filter((block) => block.inventoryItemId === id);
                return (
                  <tr key={id} role="row" className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] py-1 lg:table-row", hasDifference && "bg-amber-50/45")}>
                    <th scope="row" role="rowheader" className="col-span-2 min-w-0 px-4 py-2 text-left font-medium">
                      <div className="flex items-center gap-2.5">
                        <span className="relative size-[22px] shrink-0">
                          <input
                            type="checkbox"
                            aria-label={`Zkontrolováno: ${row.name}`}
                            className="peer block size-full cursor-pointer appearance-none rounded-md border border-line bg-white checked:border-emerald-700 checked:bg-emerald-700"
                            checked={row.checked}
                            onChange={(event) => onChecked(id, event.target.checked)}
                          />
                          <Check size={14} aria-hidden="true" className="pointer-events-none absolute inset-1 text-white opacity-0 peer-checked:opacity-100" />
                        </span>
                        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">
                          {row.imageUrl
                            ? <img loading="lazy" className="size-full object-cover" src={apiUrl(row.imageUrl)} alt="" />
                            : <Icons.Image className="size-4" aria-hidden="true" />}
                        </span>
                        <div className="min-w-0 flex-1 wrap-break-word">
                          {row.name}
                          {row.consumable && <div className="text-xs font-normal text-muted">Spotřební materiál</div>}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-md p-1.5 text-muted hover:bg-indigo-50 hover:text-indigo-700"
                          aria-label={`Manuální blokace: ${row.name}`}
                          title="Manuální blokace"
                          onClick={() => onBlock(row)}
                        >
                          <Lock size={14} />
                        </button>
                      </div>
                      {relatedBlocks.map((block) => (
                        <div key={block.id} className="mt-1 flex items-center gap-1 text-xs font-normal text-indigo-700">
                          {block.blockedQuantity} {row.unit} blokováno do {new Date(block.blockedUntil).toLocaleDateString("cs-CZ")}
                          {block.note ? ` · ${block.note}` : ""}
                          <button type="button" aria-label="Zrušit blokaci" className="rounded p-1 hover:bg-red-100 hover:text-red-700" onClick={() => onRemoveBlock(block)}><X size={13} /></button>
                        </div>
                      ))}
                    </th>
                    <td role="cell" className={`${dataCell} font-semibold tabular-nums`}>
                      <span className={mobileLabel}>Vydáno</span>
                      {wholeNumber.format(row.issued)} {row.unit}
                    </td>
                    <td role="cell" className={`${dataCell} row-start-3 lg:row-auto`}>
                      <span className={mobileLabel}>Vráceno</span>
                      <ReturnQuantity name={row.name} label="Vráceno" value={row.returned} max={Math.max(0, row.issued - row.broken)} onChange={(value) => onQuantityChange(id, "returned", value)} />
                    </td>
                    <td role="cell" className={`${dataCell} row-start-3 lg:row-auto`}>
                      <span className={mobileLabel}>Rozbito</span>
                      <ReturnQuantity name={row.name} label="Rozbito" value={row.broken} max={row.issued} highlighted={row.broken > 0} onChange={(value) => onQuantityChange(id, "broken", value)} />
                    </td>
                    <td role="cell" className={cn(dataCell, "tabular-nums", row.missing ? "font-semibold text-red-700" : "text-muted")}>
                      <span className={mobileLabel}>Chybí</span>
                      {row.consumable ? "–" : `${wholeNumber.format(row.missing)} ${row.unit}`}
                    </td>
                    <td role="cell" className={dataCell}>
                      <span className={mobileLabel}>Sklad vrácení</span>
                      <select
                        aria-label={`Sklad vrácení: ${row.name}`}
                        className="max-w-full truncate rounded-md py-1 text-[13px] text-muted"
                        value={row.target_warehouse_id ?? ""}
                        onChange={(event) => onWarehouseChange(event.target.value || undefined, id)}
                      >
                        <option value="">Výchozí sklad</option>
                        {warehouses.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </td>
                    <td role="cell" className={dataCell}>
                      <span className={mobileLabel}>Stav</span>
                      <div className="flex flex-wrap gap-1">
                        {row.broken > 0 && <Badge tone="warn">Rozbito {wholeNumber.format(row.broken)}</Badge>}
                        {row.missing > 0 && <Badge tone="danger">Chybí {wholeNumber.format(row.missing)}</Badge>}
                        {row.consumed > 0 && <Badge>Spotřebováno {wholeNumber.format(row.consumed)}</Badge>}
                        {!hasDifference && row.consumed === 0 && (row.checked ? <Badge tone="ok">V pořádku</Badge> : <Badge>Ke kontrole</Badge>)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-2 border-t border-line bg-white px-3 py-2 shadow-md md:hidden">
        <span className="text-xs font-semibold text-muted">{checkedCount} z {rows.length} zkontrolováno</span>
        <Button variant="danger" disabled={closeDisabled} onClick={onClose}>
          <Lock size={15} /> Uzavřít akci
        </Button>
      </div>
    </section>
  );
}
