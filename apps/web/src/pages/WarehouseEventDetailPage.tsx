import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiBaseUrl, apiUrl, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import toast from "react-hot-toast";
import { compareByCategoryParentName, managerLabel, statusBadgeClass, statusLabel } from "../lib/viewModel";
import { cn } from "../lib/ui";
import Modal from "../components/ui/Modal";
import { Icons } from "../lib/icons";
import { X, Plus } from "lucide-react";

type Block = { id: string; inventoryItemId: string; blockedQuantity: number; blockedUntil: string; note?: string };

type Snapshot = {
  event: { version: number };
  groups: Array<{ parentCategory: string; category: string; items: Array<{ inventoryItemId: string; name: string; unit: string; qty: number }> }>;
};

type WarehouseItem = { inventoryItemId: string; name: string; unit: string; qty: number; parentCategory?: string; category?: string };
type IssueMode = "manual" | "digital";
type DigitalIssueState = "idle" | "armed" | "confirmed";

function parseWeightValue(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(",", ".").trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatWeightKg(value: number) {
  const normalized = Math.round(value * 100) / 100;
  return `${new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: normalized % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2
  }).format(normalized)} kg`;
}

export default function WarehouseEventDetailPage() {
  const role = getCurrentUser()?.role ?? "";
  const { id } = useParams();
  const nav = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [rows, setRows] = useState<Array<{ 
    inventory_item_id: string; 
    name: string; 
    unit: string; 
    requested: number; 
    returned: number; 
    broken: number; 
    lost: number;
    total?: number; 
    parentCategory?: string; 
    category?: string;
    imageUrl?: string | null; 
    target_warehouse_id?: string;
    masterPackageQty?: number;
  }>>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [blockModal, setBlockModal] = useState<{ inventoryItemId: string; name: string; maxQty: number } | null>(null);
  const [blockQty, setBlockQty] = useState("");
  const [blockUntil, setBlockUntil] = useState("");
  const [blockNote, setBlockNote] = useState("");
  const [issueMode, setIssueMode] = useState<IssueMode | null>(null);
  const [digitalIssueStates, setDigitalIssueStates] = useState<Record<string, DigitalIssueState>>({});
  const [issueWarehouseId, setIssueWarehouseId] = useState("");
  const [issuePalletCount, setIssuePalletCount] = useState<number | "">("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const manager = managerLabel(event?.createdBy);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api<{ event: any }>(`/events/${id}`);
      setEvent(res.event);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se načíst akci.");
    } finally {
      setLoading(false);
    }
  };

  const loadBlocks = async () => {
    if (!id) return;
    try {
      const res = await api<{ blocks: Block[] }>(`/events/${id}/blocks`);
      setBlocks(res.blocks);
    } catch (e) {}
  };

  const loadWarehouses = async () => {
    try {
      const res = await api<{ warehouses: Array<{ id: string; name: string }> }>("/warehouses");
      setWarehouses(res.warehouses);
    } catch (e) {}
  };

  useEffect(() => {
    load();
    loadBlocks();
    loadWarehouses();
  }, [id]);

  const snapshot: Snapshot | null = useMemo(() => {
    const ex = (event?.exports?.[0] ?? null);
    return ex?.snapshotJson ?? null;
  }, [event]);

  const snapshotItems = useMemo(() => {
    const list =
      snapshot?.groups?.flatMap((g) => g.items.map((i) => ({ ...i, parentCategory: g.parentCategory, category: g.category }))) ?? [];
    return list;
  }, [snapshot]);

  const warehouseItems: WarehouseItem[] = useMemo(() => {
    const fromEvent = (event?.warehouseItems ?? []) as WarehouseItem[];
    if (fromEvent.length > 0) return fromEvent;
    return snapshotItems as WarehouseItem[];
  }, [event?.warehouseItems, snapshotItems]);

  useEffect(() => {
    if (event?.status !== "SENT_TO_WAREHOUSE") {
      setIssueMode(null);
    }
  }, [event?.status]);

  useEffect(() => {
    setIssuePalletCount(event?.palletCount ?? "");
  }, [event?.palletCount]);

  useEffect(() => {
    setDigitalIssueStates((prev) => {
      const next: Record<string, DigitalIssueState> = {};
      for (const item of warehouseItems) {
        next[item.inventoryItemId] = prev[item.inventoryItemId] ?? "idle";
      }
      return next;
    });
  }, [warehouseItems]);

  const imageByItemId = useMemo(() => {
    const entries = (event?.reservations ?? []).map((r: any) => {
      const imageUrl = typeof r.item?.imageUrl === "string" ? r.item.imageUrl : null;
      return [r.inventoryItemId, imageUrl] as const;
    });
    return new Map<string, string | null>(entries);
  }, [event?.reservations]);

  const itemPackagingById = useMemo(() => {
    const entries = (event?.reservations ?? []).map((r: any) => [
      r.inventoryItemId,
      {
        masterPackageQty: r.item?.masterPackageQty ?? null,
        masterPackageWeight: r.item?.masterPackageWeight ?? null
      }
    ] as const);
    return new Map<string, { masterPackageQty: number | null; masterPackageWeight: string | null }>(entries);
  }, [event?.reservations]);

  useEffect(() => {
    if (!warehouseItems.length) return;

    const serverReturns = new Map<string, { returned: number, broken: number }>();
    if (event?.returns) {
      for (const r of event.returns) {
        const current = serverReturns.get(r.inventoryItemId) || { returned: 0, broken: 0 };
        current.returned += r.returnedQuantity || 0;
        current.broken += r.brokenQuantity || 0;
        serverReturns.set(r.inventoryItemId, current);
      }
    }
    const serverLost = new Map<string, number>();
    if (event?.issues) {
      for (const issue of event.issues) {
        if (issue.type === "missing") {
          serverLost.set(issue.inventoryItemId, (serverLost.get(issue.inventoryItemId) || 0) + (issue.issuedQuantity || 0));
        }
      }
    }

    const defaultWarehouseId = warehouses.find(
      (w) => w.name.toLowerCase().includes("liboc")
    )?.id;

    setRows(
      warehouseItems.map((i) => {
        const s = serverReturns.get(i.inventoryItemId);
        return {
          inventory_item_id: i.inventoryItemId,
          name: i.name,
          unit: i.unit,
          requested: i.qty,
          returned: s?.returned ?? 0,
          broken: s?.broken ?? 0,
          lost: serverLost.get(i.inventoryItemId) ?? 0,
          parentCategory: (i as any).parentCategory || "",
          category: (i as any).category || "",
          imageUrl: imageByItemId.get(i.inventoryItemId) ?? null,
          target_warehouse_id: defaultWarehouseId,
          masterPackageQty: (i as any).masterPackageQty
        };
      })
    );
  }, [warehouseItems, event?.returns, event?.issues, imageByItemId, warehouses]);

  useEffect(() => {
    if (!id || warehouseItems.length === 0) return;
    api<{ rows: Array<{ inventoryItemId: string; physicalTotal: number; blockedTotal: number; available: number }> }>(
      `/events/${id}/availability`,
      {
        method: "POST",
        body: JSON.stringify({ inventory_item_ids: warehouseItems.map((x) => x.inventoryItemId) })
      }
    )
      .then((r) => {
        const byId = new Map<string, { physicalTotal: number }>(
          r.rows.map((x: { inventoryItemId: string; physicalTotal: number }) => [x.inventoryItemId, x])
        );
        setRows((prev) =>
          prev.map((p) => ({
            ...p,
            total: byId.get(p.inventory_item_id)?.physicalTotal ?? undefined
          }))
        );
      })
      .catch(() => { });
  }, [id, warehouseItems]);

  const issueData = useMemo(() => {
    const issuedMap = new Map<string, number>();
    const lostMap = new Map<string, number>();
    if (event?.issues) {
      for (const i of event.issues) {
        if (i.type === "issued") {
          issuedMap.set(i.inventoryItemId, (issuedMap.get(i.inventoryItemId) || 0) + (i.issuedQuantity || 0));
        } else if (i.type === "broken" || i.type === "missing") {
          lostMap.set(i.inventoryItemId, (lostMap.get(i.inventoryItemId) || 0) + (i.issuedQuantity || 0));
        }
      }
    }
    return { issuedMap, lostMap };
  }, [event?.issues]);

  const groupedRows = useMemo(() => {
    type CatGroup = { parent: string; sub: string; items: typeof rows };
    const sections: Array<{ title: string; groups: CatGroup[] }> = [
      { title: "Event Manager", groups: [] },
      { title: "Kuchyň", groups: [] }
    ];
    const groupMap = new Map<string, CatGroup>();
    for (const r of rows) {
      const parent = r.parentCategory || "Ostatní";
      const sub = r.category || "Nezařazeno";
      const key = `${parent}||${sub}`;
      const g = groupMap.get(key) ?? { parent, sub, items: [] as typeof rows };
      g.items.push(r);
      groupMap.set(key, g);
    }
    const sortedGroups = Array.from(groupMap.values()).sort((a, b) => compareByCategoryParentName(
      { parentCategory: a.parent, category: a.sub },
      { parentCategory: b.parent, category: b.sub }
    ));
    for (const g of sortedGroups) {
      const isKitchen = g.parent.toLowerCase() === "kuchyň" || g.parent.toLowerCase() === "kuchyn";
      if (isKitchen) {
        sections[1].groups.push(g);
      } else {
        sections[0].groups.push(g);
      }
    }
    return sections;
  }, [rows]);

  const digitalIssueSummary = useMemo(() => {
    let confirmed = 0;
    for (const item of warehouseItems) {
      const state = digitalIssueStates[item.inventoryItemId] ?? "idle";
      if (state === "confirmed") confirmed += 1;
    }
    const total = warehouseItems.length;
    return {
      total,
      confirmed,
      remaining: Math.max(0, total - confirmed),
      allConfirmed: total > 0 && confirmed === total
    };
  }, [digitalIssueStates, warehouseItems]);

  const computedIssueWeightLabel = useMemo(() => {
    const itemsForWeight =
      issueMode === "digital"
        ? rows.filter((row) => (digitalIssueStates[row.inventory_item_id] ?? "idle") === "confirmed")
        : rows;

    const totalKg = itemsForWeight.reduce((sum, row) => {
      const packaging = itemPackagingById.get(row.inventory_item_id);
      const packageWeightKg = parseWeightValue(packaging?.masterPackageWeight);
      const packageQty = packaging?.masterPackageQty ?? null;
      if (!packageWeightKg || !packageQty || packageQty <= 0) return sum;
      return sum + Math.ceil(row.requested / packageQty) * packageWeightKg;
    }, 0);

    return totalKg > 0 ? formatWeightKg(totalKg) : "Nelze dopočítat";
  }, [digitalIssueStates, issueMode, itemPackagingById, rows]);

  const updateDigitalIssueState = (inventoryItemId: string, nextState: DigitalIssueState) => {
    setDigitalIssueStates((prev) => ({ ...prev, [inventoryItemId]: nextState }));
  };

  const getIssuedQtyForItem = (inventoryItemId: string, fallbackQty: number) => {
    return issueData.issuedMap.get(inventoryItemId) ?? fallbackQty;
  };

  const getComputedReturnedQty = (row: { inventory_item_id: string; requested: number; broken: number; lost: number }) => {
    return Math.max(0, getIssuedQtyForItem(row.inventory_item_id, row.requested) - row.broken - row.lost);
  };

  const markItemsAsFullyReturned = (inventoryItemIds: string[]) => {
    const ids = new Set(inventoryItemIds);
    setRows((prev) =>
      prev.map((row) =>
        ids.has(row.inventory_item_id)
          ? {
              ...row,
              returned: getIssuedQtyForItem(row.inventory_item_id, row.requested),
              broken: 0,
              lost: 0
            }
          : row
      )
    );
  };

  const canWarehouse = ["warehouse", "admin"].includes(role);
  if (!canWarehouse) {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-slate-700">Pouze sklad / admin.</div>
        </CardContent>
      </Card>
    );
  }

  if (loading || !event) {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-3 h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const issueDisabled = event.status !== "SENT_TO_WAREHOUSE" || event.exportNeedsRevision || warehouseItems.length === 0;
  const closeDisabled = event.status !== "ISSUED" || rows.length === 0;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => nav("/warehouse")}>
        Zpět na seznam
      </Button>

      {event.status === "SENT_TO_WAREHOUSE" && warehouseItems.length === 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent>
            <div className="text-sm font-semibold text-amber-900">Export neobsahuje položky</div>
            <div className="mt-1 text-sm text-amber-800">
              V akci nejsou žádné položky k výdeji. Požádej event managera o doplnění a nové předání skladu.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {event.exportNeedsRevision ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent>
            <div className="text-sm font-semibold text-amber-900">Pozor: změny po předání</div>
            <div className="mt-1 text-sm text-amber-800">
              Akce byla upravena po předání. Před výdejem je nutný nový export.
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{event.name}</div>
              {manager ? (
                <div className="text-sm font-medium text-slate-900 mt-1">
                  Manažer: {manager}
                </div>
              ) : null}
              <div className="text-sm text-slate-600">{event.location}</div>
              <div className="mt-2 text-xs text-slate-500">
                {new Date(event.deliveryDatetime).toLocaleString()} → {new Date(event.pickupDatetime).toLocaleString()}
              </div>
              {event.notes ? (
                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700 whitespace-pre-wrap">
                  <span className="font-semibold text-slate-600">Poznámka:</span> {event.notes}
                </div>
              ) : null}

              {(event.palletCount || event.totalWeight) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {event.palletCount ? (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-[11px] font-bold">
                      <Icons.Box className="h-3 w-3" /> {event.palletCount} palet
                    </div>
                  ) : null}
                  {event.totalWeight ? (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 border border-orange-100 text-orange-700 text-[11px] font-bold">
                      <Icons.Scale className="h-3 w-3" /> {event.totalWeight}
                    </div>
                  ) : null}
                  {blocks.length > 0 ? (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 border border-purple-100 text-purple-700 text-[11px] font-bold">
                      <Icons.Lock className="h-3 w-3" /> {blocks.length} blokací
                    </div>
                  ) : null}
                </div>
              )}
              {snapshot?.event?.version ? (
                <div className="mt-2 text-xs text-slate-500">Export verze: v{snapshot.event.version}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-start gap-2 sm:shrink-0 sm:flex-col sm:items-end sm:text-right">
              <Badge className={statusBadgeClass(event.status)}>
                {statusLabel(event.status)}
              </Badge>
              {event.chefConfirmedAt ? (
                <div className="flex items-center gap-1 text-[10px] font-medium text-green-700 sm:mt-1 sm:justify-end">
                  <span>✓ Kuchyň potvrzena</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[10px] font-medium text-amber-700 sm:mt-1 sm:justify-end">
                  <span>⏲ Čeká na kuchyň</span>
                </div>
              )}
            </div>
          </div>
          {event.status === "CLOSED" ? (
            <div className="mt-4">
              <Button
                size="sm"
                variant="secondary"
                className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-100"
                onClick={() => {
                  const token = localStorage.getItem("token");
                  window.open(`${apiBaseUrl()}/events/${id}/report-pdf?token=${encodeURIComponent(token ?? "")}`, "_blank");
                }}
              >
                Stáhnout závěrečný report (PDF)
              </Button>
            </div>
          ) : null}

        </CardContent>
      </Card>
      {event.status === "CLOSED" ? (
        <Card className="border-red-100 bg-red-50/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-sm font-bold text-red-800">
              <Icons.Alert className="h-4 w-4" />
              Přehled ztrát a poškození
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {event.issues
                ?.filter((issue: any) => (issue.issuedQuantity || 0) > 0 && issue.type !== "issued")
                .map((issue: any) => (
                  <div key={issue.id} className="flex items-center justify-between text-sm">
                    <div className="text-slate-700">{issue.item?.name}</div>
                    <div className="font-medium text-red-700">
                      {issue.issuedQuantity || 0} {issue.item?.unit} ({issue.type === "broken" ? "rozbito" : "chybí"})
                    </div>
                  </div>
                ))}
              {(!event.issues || event.issues.filter((i: any) => i.type !== "issued").length === 0) && (
                <div className="text-sm text-slate-500 italic">Žádné zaznamenané ztráty.</div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="text-sm font-semibold">Akce</div>
            <div className="mt-1 text-sm text-slate-600">
              {event.status === "SENT_TO_WAREHOUSE"
                ? "Vyber způsob vydání. Manuální režim otevře PDF checklist, digitální režim vede skladníka po položkách."
                : "Po vydání lze akci už jen uzavřít a zapsat vrácené / rozbité kusy."}
            </div>
          </CardHeader>
          <CardContent>
            {event.status === "SENT_TO_WAREHOUSE" ? (
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    disabled={issueDisabled}
                    onClick={() => setIssueMode("manual")}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition",
                      issueMode === "manual"
                        ? "border-indigo-300 bg-indigo-50 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                      issueDisabled && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <div className="text-sm font-semibold text-slate-900">Manuální výdej</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Otevře checklist v PDF, skladník si položky odškrtá na papíře a pak hromadně potvrdí výdej.
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={issueDisabled}
                    onClick={() => setIssueMode("digital")}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition",
                      issueMode === "digital"
                        ? "border-emerald-300 bg-emerald-50 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                      issueDisabled && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <div className="text-sm font-semibold text-slate-900">Digitální výdej</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Položky se potvrzují v aplikaci po jedné. Každá položka má krok „Vydat“ a následné „Potvrdit“.
                    </div>
                  </button>
                </div>

                {issueMode === "manual" ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-900">Manuální checklist</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Nejprve otevři PDF podle potřeby, po fyzickém odškrtnutí položek potvrď celé vydání.
                    </div>
                    {snapshot?.event?.version ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const token = localStorage.getItem("token");
                            window.open(`${apiBaseUrl()}/events/${id}/exports/${snapshot.event.version}/pdf?type=general&token=${encodeURIComponent(token ?? "")}`, "_blank");
                          }}
                        >
                          Otevřít checklist (Sklad)
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const token = localStorage.getItem("token");
                            window.open(`${apiBaseUrl()}/events/${id}/exports/${snapshot.event.version}/pdf?type=kitchen&token=${encodeURIComponent(token ?? "")}`, "_blank");
                          }}
                        >
                          Otevřít checklist (Kuchyň)
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const token = localStorage.getItem("token");
                            window.open(`${apiBaseUrl()}/events/${id}/exports/${snapshot.event.version}/pdf?token=${encodeURIComponent(token ?? "")}`, "_blank");
                          }}
                        >
                          Otevřít checklist (Kompletní)
                        </Button>
                      </div>
                    ) : null}
                    <div className="mt-4">
                      <Button full disabled={issueDisabled} onClick={() => setConfirmIssue(true)}>
                        Potvrdit manuální vydání
                      </Button>
                    </div>
                  </div>
                ) : null}

                {issueMode === "digital" ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Digitální checklist</div>
                        <div className="mt-1 text-sm text-slate-600">
                          U každé položky nejprve klikni na „Vydat“, pak na „Potvrdit“. Finální tlačítko se zpřístupní až po potvrzení všech položek.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                          Potvrzeno: {digitalIssueSummary.confirmed}/{digitalIssueSummary.total}
                        </span>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">
                          K potvrzení: {digitalIssueSummary.remaining}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4">
                      <Button full disabled={issueDisabled || !digitalIssueSummary.allConfirmed} onClick={() => setConfirmIssue(true)}>
                        Potvrdit digitální vydání
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!issueMode ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Vyber režim vydání. Manuální ponechá práci s PDF checklistem, digitální zobrazí odškrtávání přímo u položek níže.
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Button full variant="danger" disabled={closeDisabled} onClick={() => setConfirmClose(true)}>
                  Uzavřít akci
                </Button>
                <div className="mt-2 text-xs text-slate-600">
                  Uzavření provede odepsání rozbitého a chybějícího množství.
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Položky</div>
          <div className="mt-1 text-sm text-slate-600">Požadované množství je z posledního exportu.</div>
          
          {event?.status === "ISSUED" && warehouseItems.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <div className="flex min-h-10 items-center gap-2">
                <input 
                  type="checkbox"
                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  checked={selectedIds.size === warehouseItems.length && warehouseItems.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const allIds = warehouseItems.map((i) => i.inventoryItemId);
                      setSelectedIds(new Set(allIds));
                      markItemsAsFullyReturned(allIds);
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                />
                <span className="text-xs font-medium text-slate-600">Vybrat vše ({selectedIds.size})</span>
              </div>

              {selectedIds.size > 0 && warehouses.length > 0 && (
                <div className="flex flex-col gap-2 sm:border-l sm:border-slate-200 sm:pl-4">
                  <span className="text-xs font-semibold text-slate-600">Hromadně vrátit na:</span>
                  <select 
                    className="block min-h-10 w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500 sm:w-auto sm:min-w-48 sm:py-1 sm:pl-2 sm:text-xs"
                    defaultValue=""
                    onChange={(e) => {
                      const wid = e.target.value || undefined;
                      if (!wid) return;
                      setRows(prev => prev.map(r => {
                        if (selectedIds.has(r.inventory_item_id)) {
                          return { ...r, target_warehouse_id: wid };
                        }
                        return r;
                      }));
                      toast.success(`Nastaven sklad pro ${selectedIds.size} položek`);
                    }}
                  >
                    <option value="">(Vybrat sklad...)</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {groupedRows.every(s => s.groups.length === 0) ? (
            <div className="text-sm text-slate-600">Pro tuto akci nejsou žádné položky.</div>
          ) : (
            <div className="space-y-8">
              {groupedRows.filter(s => s.groups.length > 0).map((section) => (
                <div key={section.title}>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-200" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{section.title}</h3>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div className="space-y-4">
                    {section.groups.map((g) => (
                      <div key={`${g.parent}/${g.sub}`}>
                        <div className="mb-2 flex items-center gap-2">
                          <Badge>{g.parent}</Badge>
                          <Badge tone="neutral">{g.sub}</Badge>
                        </div>
                        <div className="space-y-3">
                    {g.items.map((r) => {
                      const issuedQty = getIssuedQtyForItem(r.inventory_item_id, r.requested);
                      const computedReturned = getComputedReturnedQty(r);
                      const variance = r.broken + r.lost;
                      const existingBlocks = blocks.filter(b => b.inventoryItemId === r.inventory_item_id);
                      return (
                        <div key={r.inventory_item_id} className={cn(
                          "rounded-2xl border p-3 transition-colors",
                          selectedIds.has(r.inventory_item_id) ? "border-purple-200 bg-purple-50/30" : "border-slate-200"
                        )}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              {event.status === "ISSUED" && (
                                <input 
                                  type="checkbox"
                                  className="mt-1 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                  checked={selectedIds.has(r.inventory_item_id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedIds);
                                    if (e.target.checked) {
                                      next.add(r.inventory_item_id);
                                      markItemsAsFullyReturned([r.inventory_item_id]);
                                    } else {
                                      next.delete(r.inventory_item_id);
                                    }
                                    setSelectedIds(next);
                                  }}
                                />
                              )}
                              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-100 flex items-center justify-center">
                                {r.imageUrl ? (
                                  <img className="h-full w-full object-cover" src={apiUrl(r.imageUrl)} alt={r.name} />
                                ) : (
                                  <Icons.Image className="h-5 w-5 text-slate-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{r.name}</div>
                                  <div className="mt-1 text-xs text-slate-600">
                                    Požadováno: <span className="font-semibold text-slate-900">{r.requested}</span> {r.unit}
                                    {r.masterPackageQty && r.masterPackageQty > 0 ? (
                                      <span className="ml-1 text-[10px] font-medium text-blue-600">
                                        ({Math.ceil(r.requested / r.masterPackageQty)} bal.)
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600">
                                    Celkem skladem: <span className="font-semibold text-slate-900">{r.total ?? "—"}</span> {r.unit}
                                  </div>
                              </div>
                            </div>
                            <div className="flex justify-start sm:w-28 sm:shrink-0 sm:justify-end">
                              <Badge tone={variance > 0 ? "warn" : "ok"}>
                                {variance > 0 ? `Odchylka: ${variance}` : "V pořádku"}
                              </Badge>
                            </div>
                          </div>

                          {event.status === "CLOSED" || event.status === "ISSUED" ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                              {issueData.issuedMap.has(r.inventory_item_id) ? (
                                <div className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                  Vydáno: {issueData.issuedMap.get(r.inventory_item_id)} {r.unit}
                                </div>
                              ) : null}
                              {event.status === "ISSUED" ? (
                                <div className="text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">
                                  Vrátí se: {computedReturned} {r.unit}
                                </div>
                              ) : null}
                              {(issueData.lostMap.get(r.inventory_item_id) || 0) > 0 ? (
                                <div className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                                  Ztráty: {issueData.lostMap.get(r.inventory_item_id)} {r.unit}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {event.status === "SENT_TO_WAREHOUSE" && issueMode === "digital" ? (
                            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-emerald-900">
                                  Digitální výdej
                                </div>
                                <Badge
                                  tone={
                                    (digitalIssueStates[r.inventory_item_id] ?? "idle") === "confirmed"
                                      ? "ok"
                                      : (digitalIssueStates[r.inventory_item_id] ?? "idle") === "armed"
                                        ? "warn"
                                        : "neutral"
                                  }
                                >
                                  {(digitalIssueStates[r.inventory_item_id] ?? "idle") === "confirmed"
                                    ? "Potvrzeno"
                                    : (digitalIssueStates[r.inventory_item_id] ?? "idle") === "armed"
                                      ? "Čeká na potvrzení"
                                      : "Nepotvrzeno"}
                                </Badge>
                              </div>
                              <div className="mt-2 text-xs text-emerald-900/80">
                                1. klikni na „Vydat“, 2. klikni na „Potvrdit“. Teprve pak je položka připravená k finálnímu potvrzení celé akce.
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant={(digitalIssueStates[r.inventory_item_id] ?? "idle") === "idle" ? "primary" : "secondary"}
                                  onClick={() => {
                                    const current = digitalIssueStates[r.inventory_item_id] ?? "idle";
                                    updateDigitalIssueState(
                                      r.inventory_item_id,
                                      current === "idle" ? "armed" : "idle"
                                    );
                                  }}
                                >
                                  {(digitalIssueStates[r.inventory_item_id] ?? "idle") === "idle"
                                    ? "Vydat"
                                    : (digitalIssueStates[r.inventory_item_id] ?? "idle") === "armed"
                                      ? "Zrušit"
                                      : "Vrátit zpět"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={(digitalIssueStates[r.inventory_item_id] ?? "idle") !== "armed"}
                                  onClick={() => updateDigitalIssueState(r.inventory_item_id, "confirmed")}
                                >
                                  {(digitalIssueStates[r.inventory_item_id] ?? "idle") === "confirmed" ? "Potvrzeno" : "Potvrdit"}
                                </Button>
                              </div>
                            </div>
                          ) : null}

                          {event.status === "ISSUED" ? (
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <label className="text-xs col-span-2 sm:col-span-1">
                                Vráceno automaticky
                                <Input
                                  className="mt-1"
                                  type="number"
                                  min={0}
                                  value={computedReturned}
                                  disabled
                                />
                              </label>
                              <label className="text-xs">
                                Rozbito
                                <Input
                                  className="mt-1"
                                  type="number"
                                  min={0}
                                  value={r.broken}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => {
                                    const requestedValue = Math.max(0, Number(e.target.value));
                                    const nextBroken = Math.min(requestedValue, Math.max(0, issuedQty - r.lost));
                                    setRows((prev) =>
                                      prev.map((x) => (x.inventory_item_id === r.inventory_item_id ? { ...x, broken: nextBroken } : x))
                                    );
                                  }}
                                />
                              </label>
                              <label className="text-xs">
                                Ztracené / chybí
                                <Input
                                  className="mt-1"
                                  type="number"
                                  min={0}
                                  value={r.lost}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => {
                                    const requestedValue = Math.max(0, Number(e.target.value));
                                    const nextLost = Math.min(requestedValue, Math.max(0, issuedQty - r.broken));
                                    setRows((prev) =>
                                      prev.map((x) => (x.inventory_item_id === r.inventory_item_id ? { ...x, lost: nextLost } : x))
                                    );
                                  }}
                                />
                              </label>
                              <label className="text-xs col-span-2 sm:col-span-1">
                                Sklad vrácení
                                <select 
                                  className="mt-1 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                                  value={r.target_warehouse_id || ""}
                                  onChange={(e) => {
                                    const v = e.target.value || undefined;
                                    setRows((prev) => prev.map((x) => (x.inventory_item_id === r.inventory_item_id ? { ...x, target_warehouse_id: v } : x)));
                                  }}
                                >
                                  <option value="">Beze skladu</option>
                                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                              </label>
                            </div>
                          ) : null}

                          {existingBlocks.length > 0 && (
                            <div className="mt-3 space-y-1">
                              {existingBlocks.map(b => (
                                <div key={b.id} className="flex flex-col gap-2 rounded border border-purple-200 bg-purple-50 px-2 py-2 text-xs text-purple-800 sm:flex-row sm:items-center sm:justify-between sm:py-1.5">
                                  <div className="pr-2">
                                    <span className="font-semibold">{b.blockedQuantity} {r.unit}</span> blokováno do {new Date(b.blockedUntil).toLocaleDateString("cs-CZ")}
                                    {b.note ? <span className="ml-2 block text-purple-600 sm:inline italic">({b.note})</span> : null}
                                  </div>
                                  <button
                                    className="self-end rounded p-1 hover:text-red-600 transition-colors sm:self-auto"
                                    onClick={async () => {
                                      if (confirm("Opravdu zrušit tuto manuální blokaci?")) {
                                        try {
                                          await api(`/events/${id}/blocks/${b.id}`, { method: "DELETE" });
                                          toast.success("Blokace zrušena");
                                          loadBlocks();
                                        } catch (e: any) {
                                          toast.error(e?.error?.message ?? "Chyba při rušení blokace.");
                                        }
                                      }
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {event.status !== "CLOSED" ? (
                            <div className="mt-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-purple-700 hover:text-purple-800 hover:bg-purple-50 -ml-2"
                                onClick={() => {
                                  setBlockModal({ inventoryItemId: r.inventory_item_id, name: r.name, maxQty: r.requested });
                                  setBlockQty(String(r.requested));
                                  const dt = new Date(event.pickupDatetime);
                                  dt.setDate(dt.getDate() + 1); // Default +1 day
                                  // format to datetime-local
                                  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
                                  setBlockUntil(dt.toISOString().slice(0, 16));
                                  setBlockNote("");
                                }}
                              >
                                <Plus className="mr-1 h-3 w-3" /> Manuální blokace
                              </Button>
                            </div>
                          ) : null}

                        </div>
                      );
                    })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={setConfirmIssue}
        title="Potvrdit vydání?"
        description={
          issueMode === "digital"
            ? "Digitální checklist je kompletní. Tímto krokem se skutečně odečtou položky ze skladu a akce se přepne do stavu Vydáno."
            : "Výdej uzamkne akci pro běžné úpravy."
        }
        confirmText={issueMode === "digital" ? "Potvrdit digitální výdej" : "Potvrdit výdej"}
        onConfirm={async () => {
          if (!id) return;
          if (issueMode === "digital" && !digitalIssueSummary.allConfirmed) {
            toast.error("Nejdřív potvrď všechny položky v digitálním checklistu.");
            return;
          }
          try {
            await api(`/events/${id}/issue`, { 
              method: "POST", 
              body: JSON.stringify({ 
                idempotency_key: `${issueMode ?? "issue"}:${Date.now()}`,
                warehouse_id: issueWarehouseId || undefined,
                pallet_count: issuePalletCount === "" ? null : Number(issuePalletCount),
                items:
                  issueMode === "digital"
                    ? rows
                        .filter((row) => (digitalIssueStates[row.inventory_item_id] ?? "idle") === "confirmed")
                        .map((row) => ({
                          inventory_item_id: row.inventory_item_id,
                          issued_quantity: row.requested
                        }))
                    : undefined
              }) 
            });
            toast.success(issueMode === "digital" ? "Digitální vydání potvrzeno" : "Vydání potvrzeno");
            await load();
          } catch (e: any) {
            toast.error(e?.error?.message ?? "Nepodařilo se potvrdit výdej.");
          }
        }}
      >
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
              Vydáváno ze skladu
            </span>
            <select 
              className="block w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
              value={issueWarehouseId}
              onChange={(e) => setIssueWarehouseId(e.target.value)}
            >
              <option value="">(Výchozí sklad položky)</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Počet palet
              <Input
                className="mt-1"
                type="number"
                min={0}
                value={issuePalletCount}
                onChange={(e) => setIssuePalletCount(e.target.value ? Number(e.target.value) : "")}
                placeholder="Např. 3"
              />
            </label>
            <label className="text-sm">
              Celková váha
              <Input
                className="mt-1"
                value={computedIssueWeightLabel}
                disabled
              />
            </label>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        tone="danger"
        title="Uzavřít akci?"
        description="Výchozí stav je, že se vše vrátilo. Zadávají se jen rozbité a ztracené kusy, vrácené množství dopočítáme automaticky ze skutečně vydaného počtu."
        confirmText="Uzavřít"
        onConfirm={async () => {
          if (!id) return;
          try {
            await api(`/events/${id}/return-close`, {
              method: "POST",
              body: JSON.stringify({
                idempotency_key: `close:${Date.now()}`,
                items: rows.map((r) => ({
                  inventory_item_id: r.inventory_item_id,
                  returned_quantity: getComputedReturnedQty(r),
                  broken_quantity: r.broken,
                  target_warehouse_id: r.target_warehouse_id
                }))
              })
            });
            toast.success("Akce uzavřena");
            await load();
          } catch (e: any) {
            toast.error(e?.error?.message ?? "Nepodařilo se uzavřít akci.");
          }
        }}
      />

      <Modal open={blockModal !== null} onOpenChange={() => setBlockModal(null)} title="Manuální blokace skladu">
        {blockModal && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              Nastavujete manuální blokaci pro <span className="font-semibold text-slate-800">{blockModal.name}</span>.
              Blokované množství bude navíc ke stávajícím pravidlům bráno jako nedostupné pro ostatní akce.
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Množství
                <Input
                  type="number"
                  min={1}
                  max={blockModal.maxQty || undefined}
                  className="mt-1"
                  value={blockQty}
                  onChange={(e) => setBlockQty(e.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Blokovat do
                <Input
                  type="datetime-local"
                  className="mt-1"
                  value={blockUntil}
                  onChange={(e) => setBlockUntil(e.target.value)}
                />
              </label>
            </div>
            <label className="text-sm font-medium">
              Poznámka
              <Input
                placeholder="Např. Potřeba čištění"
                className="mt-1"
                value={blockNote}
                onChange={(e) => setBlockNote(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setBlockModal(null)}>Zrušit</Button>
              <Button 
                onClick={async () => {
                  try {
                    const q = Number(blockQty);
                    if (!q || q <= 0 || !blockUntil) {
                      toast.error("Vyplňte platné množství a datum.");
                      return;
                    }
                    const d = new Date(blockUntil);
                    if (isNaN(d.getTime())) {
                      toast.error("Neplatné datum.");
                      return;
                    }

                    await api(`/events/${id}/blocks`, {
                      method: "POST",
                      body: JSON.stringify({
                        inventoryItemId: blockModal.inventoryItemId,
                        blockedQuantity: q,
                        blockedUntil: d.toISOString(),
                        note: blockNote || undefined
                      })
                    });
                    
                    toast.success("Manuální blokace vytvořena.");
                    setBlockModal(null);
                    await loadBlocks();
                  } catch (e: any) {
                    toast.error(e?.error?.message ?? "Chyba při tvorbě blokace");
                  }
                }}
              >
                Uložit blokaci
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div >
  );
}
