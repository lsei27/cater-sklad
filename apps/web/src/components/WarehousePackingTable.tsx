import { Check, MapPin, PackageCheck, ScanLine, X } from "lucide-react";
import { useState } from "react";
import { apiUrl } from "../lib/api";
import { Icons } from "../lib/icons";
import { cn } from "../lib/ui";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { Card } from "./ui/Card";
import Input from "./ui/Input";
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
type PackingState = "idle" | "armed" | "confirmed";

export default function WarehousePackingTable({
  rows,
  states,
  saving,
  disabled,
  codes,
  changes,
  blocks,
  onUpdate,
  onBlock,
  onRemoveBlock,
}: {
  rows: PackingRow[];
  states: Record<string, PackingState>;
  saving: Set<string>;
  disabled: boolean;
  codes: Map<string, string>;
  changes: Map<string, { added: boolean; from?: number }>;
  blocks: Block[];
  onUpdate: (id: string, state: PackingState) => void;
  onBlock: (row: PackingRow) => void;
  onRemoveBlock: (block: Block) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"pending" | "done" | "missing" | "all">("all");
  const [byWarehouse, setByWarehouse] = useState(true);
  const completed = rows.filter((row) => states[row.inventory_item_id] === "confirmed").length;
  const shortage = (row: PackingRow) =>
    states[row.inventory_item_id] !== "confirmed" && row.total !== undefined && row.total < row.requested;
  const missing = rows.filter(shortage).length;
  const percentage = rows.length ? Math.round((100 * completed) / rows.length) : 0;
  const term = search.trim().toLocaleLowerCase("cs");
  const groups = new Map<string, PackingRow[]>();
  for (const row of rows) {
    const checked = states[row.inventory_item_id] === "confirmed";
    if (
      (filter === "done" && !checked) ||
      (filter === "pending" && checked) ||
      (filter === "missing" && !shortage(row))
    )
      continue;
    if (
      term &&
      ![row.name, row.inventory_item_id, codes.get(row.inventory_item_id) ?? ""].some((value) =>
        value.toLocaleLowerCase("cs").includes(term)
      )
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
        <div className="min-w-40 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
            <span>
              {completed} z {rows.length} položek vychystáno
            </span>
          <span className="whitespace-nowrap text-indigo-700">{percentage} %</span>
          </div>
          <progress
            value={completed}
            max={Math.max(rows.length, 1)}
            aria-label="Vychystané položky"
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
            <dd className="text-lg font-bold leading-6 text-ink">{rows.length - completed}</dd>
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
            placeholder="Naskenujte kód nebo napište název položky…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <SegmentedControl
          label="Stav vychystání"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: `Zbývá ${rows.length - completed}` },
            { value: "done", label: `Hotovo ${completed}` },
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
          <MapPin size={16} /> {byWarehouse ? "Podle umístění" : "Podle kategorie"}
        </Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="work-table w-full sm:min-w-[565px] text-sm">
          <thead className="table-header max-sm:sr-only">
            <tr>
              <th scope="col">Položka</th>
              <th scope="col">Umístění</th>
              <th scope="col">Požadováno</th>
              <th scope="col">Vychystáno</th>
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
                const state = states[id] ?? "idle";
                const checked = state === "confirmed";
                const short = shortage(row);
                const itemChange = changes.get(id);
                const relatedBlocks = blocks.filter((block) => block.inventoryItemId === id);
                const code = codes.get(id);
                return (
                  <tr key={id} className={cn("packing-line", short ? "bg-red-50/60" : itemChange && "bg-amber-50/70")}>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {checked && <Check size={16} className="shrink-0 text-emerald-700" aria-label="Vychystáno" />}
                        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">
                          {row.imageUrl ? (
                            <img loading="lazy" className="size-full object-cover" src={apiUrl(row.imageUrl)} alt="" />
                          ) : (
                            <Icons.Image className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">{row.name}</div>
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
                      {row.warehouseName || "–"}
                      {row.category && <div>{row.category}</div>}
                    </td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums whitespace-nowrap">
                      <span className="mb-0.5 block text-xs font-normal text-muted sm:hidden">Požadováno</span>
                      {row.requested} {row.unit}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                      <span className="mb-0.5 block text-xs font-normal text-muted sm:hidden">Vychystáno</span>
                      {checked ? row.requested : "0"} {row.unit}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {checked ? (
                          <>
                            <Badge tone="ok">Hotovo</Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={saving.has(id) || disabled}
                              onClick={() => onUpdate(id, "idle")}
                            >
                              Vrátit do seznamu
                            </Button>
                          </>
                        ) : state === "armed" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={saving.has(id) || disabled}
                              onClick={() => onUpdate(id, "confirmed")}
                            >
                              <Check size={14} /> Potvrdit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={saving.has(id) || disabled}
                              onClick={() => onUpdate(id, "idle")}
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
                              disabled={saving.has(id) || disabled}
                              onClick={() => onUpdate(id, "armed")}
                            >
                              <PackageCheck size={14} /> Vydat vše
                            </Button>
                          </>
                        )}
                        {!checked && (
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
