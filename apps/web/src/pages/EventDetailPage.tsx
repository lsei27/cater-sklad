import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, apiBaseUrl, getCurrentUser, getToken } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Skeleton from "../components/ui/Skeleton";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Modal from "../components/ui/Modal";
import toast from "react-hot-toast";
import { humanError, statusLabel, stockTone } from "../lib/viewModel";
import { cn } from "../lib/ui";
import { ArrowLeft, Ban, FileDown, PackagePlus, ShieldAlert, Wand2 } from "lucide-react";
import { Icons } from "../lib/icons";

const STATUS_STEPS = ["DRAFT", "READY_FOR_WAREHOUSE", "SENT_TO_WAREHOUSE", "ISSUED", "CLOSED"] as const;

function Stepper(props: { status: string }) {
  if (props.status === "CANCELLED") {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
        <Ban className="h-4 w-4" /> Zrušeno
      </div>
    );
  }
  const idx = STATUS_STEPS.indexOf(props.status as any);
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_STEPS.map((s, i) => (
        <div key={s} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs", i <= idx ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>
          <div className={cn("h-2 w-2 rounded-full", i <= idx ? "bg-white" : "bg-slate-300")} />
          {statusLabel(s)}
        </div>
      ))}
    </div>
  );
}

type StockRow = { inventoryItemId: string; physicalTotal: number; blockedTotal: number; available: number };

export default function EventDetailPage() {
  const role = getCurrentUser()?.role ?? "";
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const deepLinkHandled = useRef(false);

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stockByItemId, setStockByItemId] = useState<Map<string, StockRow>>(new Map());

  const [addOpen, setAddOpen] = useState(false);
  const [addInitialSearch, setAddInitialSearch] = useState<string | undefined>(undefined);
  const [addFocusItemId, setAddFocusItemId] = useState<string | undefined>(undefined);
  const [exportConfirm, setExportConfirm] = useState(false);
  const [chefConfirm, setChefConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api<{ event: any }>(`/events/${id}`);
      setEvent(res.event);
    } catch (e: any) {
      toast.error(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (!event || deepLinkHandled.current) return;
    const params = new URLSearchParams(loc.search);
    if (params.get("addItems") !== "1") return;
    if (event.status === "ISSUED" || event.status === "CLOSED" || event.status === "CANCELLED") {
      deepLinkHandled.current = true;
      toast.error("Akce je už uzamčená (vydaná nebo uzavřená).");
      return;
    }
    deepLinkHandled.current = true;
    setAddInitialSearch(params.get("q") ?? undefined);
    setAddFocusItemId(params.get("focusItemId") ?? undefined);
    setAddOpen(true);
    params.delete("addItems");
    params.delete("q");
    params.delete("focusItemId");
    const nextSearch = params.toString();
    nav({ pathname: loc.pathname, search: nextSearch ? `?${nextSearch}` : "" }, { replace: true });
  }, [event, loc.pathname, loc.search, nav]);

  const reservationItems = useMemo<
    Array<{ inventoryItemId: string; reservedQuantity: number; state: string; item: any }>
  >(() => {
    const list = (event?.reservations ?? []).map((r: any) => ({
      inventoryItemId: r.inventoryItemId as string,
      reservedQuantity: Number(r.reservedQuantity),
      state: String(r.state),
      item: r.item
    }));
    return list;
  }, [event]);

  useEffect(() => {
    if (!id) return;
    if (reservationItems.length === 0) {
      setStockByItemId(new Map());
      return;
    }
    api<{ rows: StockRow[] }>(`/events/${id}/availability`, {
      method: "POST",
      body: JSON.stringify({ inventory_item_ids: reservationItems.map((it) => it.inventoryItemId) })
    })
      .then((r) => setStockByItemId(new Map(r.rows.map((x) => [x.inventoryItemId, x]))))
      .catch(() => { });
  }, [id, reservationItems.length]);

  const canEM = ["admin", "event_manager"].includes(role);
  const canChef = ["admin", "chef"].includes(role);
  const canEditEvent = event?.status !== "ISSUED" && event?.status !== "CLOSED" && event?.status !== "CANCELLED";
  const canAddItems = (canEM || canChef) && canEditEvent;

  const latestExport = event?.exports?.[0] ?? null;
  const token = getToken();
  const withToken = (url: string) => (token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url);

  const grouped = useMemo(() => {
    const groups = new Map<string, { parent: string; sub: string; rows: any[] }>();
    for (const r of reservationItems) {
      const parent = r.item?.category?.parent?.name ?? "Ostatní";
      const sub = r.item?.category?.name ?? "Nezařazeno";
      const key = `${parent}||${sub}`;
      const g = groups.get(key) ?? { parent, sub, rows: [] as any[] };
      g.rows.push(r);
      groups.set(key, g);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const ap = String(a.parent).toLowerCase() === "kuchyň" ? 0 : 1;
      const bp = String(b.parent).toLowerCase() === "kuchyň" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.parent + a.sub).localeCompare(b.parent + b.sub, "cs");
    });
  }, [reservationItems]);

  if (loading || !event) {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
            <Skeleton className="mt-4 h-8 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-3 h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => nav("/events")}>
        <ArrowLeft className="h-4 w-4" /> Zpět
      </Button>

      {event.exportNeedsRevision ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent>
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-800" />
              <div>
                <div className="text-sm font-semibold text-amber-900">Nutná revize exportu</div>
                <div className="mt-1 text-sm text-amber-800">
                  Položky byly upraveny po předání skladu. Před výdejem je potřeba vytvořit nový export.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{event.name}</div>
              <div className="mt-1 text-sm text-slate-600">{event.location}</div>
              <div className="mt-2 text-xs text-slate-500">
                {new Date(event.deliveryDatetime).toLocaleString()} → {new Date(event.pickupDatetime).toLocaleString()}
              </div>
              {latestExport?.version ? (
                <div className="mt-2 text-xs text-slate-500">
                  Poslední export: v{latestExport.version} • {new Date(latestExport.exportedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <Badge>{statusLabel(event.status)}</Badge>
            </div>
          </div>

          <div className="mt-4">
            <Stepper status={event.status} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {canEM || canChef ? (
              <Button variant="secondary" onClick={() => setAddOpen(true)} disabled={!canAddItems}>
                <PackagePlus className="h-4 w-4" /> {role === "chef" ? "Přidat Kuchyň" : "Přidat položky"}
              </Button>
            ) : null}

            {canChef ? (
              <Button variant="secondary" onClick={() => setChefConfirm(true)} disabled={event.status !== "DRAFT"}>
                <Wand2 className="h-4 w-4" /> Potvrdit kuchyň
              </Button>
            ) : null}

            {canEM ? (
              <Button onClick={() => setExportConfirm(true)} disabled={!canEditEvent}>
                <FileDown className="h-4 w-4" /> Předat skladu (PDF)
              </Button>
            ) : null}

            {canEM ? (
              <Button variant="danger" onClick={() => setCancelConfirm(true)} disabled={!canEditEvent}>
                <Ban className="h-4 w-4" /> Zrušit akci
              </Button>
            ) : null}

            {role === "admin" ? (
              <Button variant="danger" onClick={() => setHardDeleteConfirm(true)}>
                <Icons.Trash className="h-4 w-4" /> Smazat (Admin)
              </Button>
            ) : null}

            {latestExport?.pdfUrl || latestExport?.pdfPath ? (
              <Button
                variant="secondary"
                onClick={() =>
                  window.open(
                    latestExport?.pdfUrl
                      ? withToken(`${apiBaseUrl()}${latestExport.pdfUrl}`)
                      : `${apiBaseUrl()}/storage/${latestExport.pdfPath}`,
                    "_blank"
                  )
                }
              >
                Otevřít PDF
              </Button>
            ) : null}
          </div>

          <div className="mt-2 text-xs text-slate-600">
            Položky se vždy kontrolují podle termínu akce (stav skladu počítá server).
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Položky</div>
          <div className="mt-1 text-sm text-slate-600">Seskupeno podle typu a kategorie.</div>
        </CardHeader>
        <CardContent>
          {grouped.length === 0 ? (
            <div className="text-sm text-slate-600">Zatím bez položek. Přidej je pro tento termín.</div>
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={`${g.parent}/${g.sub}`}>
                  <div className="flex items-center gap-2">
                    <Badge>{g.parent}</Badge>
                    <Badge tone="neutral">{g.sub}</Badge>
                  </div>
                  <div className="mt-2 space-y-2">
                    {g.rows.map((r: any) => {
                      const stock = stockByItemId.get(r.inventoryItemId);
                      const tone = stock ? stockTone(stock.available) : "neutral";
                      return (
                        <div key={r.inventoryItemId} className="rounded-2xl border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{r.item?.name}</div>
                              <div className="mt-1 text-xs text-slate-600">
                                Požadováno: <span className="font-semibold text-slate-900">{r.reservedQuantity}</span> {r.item?.unit}
                              </div>
                              {stock ? (
                                <div className="mt-2">
                                  <div className={cn("text-sm font-semibold", tone === "ok" && "text-emerald-700", tone === "warn" && "text-amber-800", tone === "danger" && "text-red-700")}>
                                    Volné: {stock.available} {r.item?.unit}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600">
                                    Celkem: {stock.physicalTotal} · Rezervováno: {stock.blockedTotal}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 text-xs text-slate-500">Načítám dostupnost…</div>
                              )}
                            </div>
                            <Badge tone={tone as any}>{r.reservedQuantity}</Badge>
                            {canEditEvent && (role === "admin" || r.item.reservation?.createdById === getCurrentUser()?.id || (role === "chef" && canChef)) ? (
                              <button
                                className="ml-2 p-1 text-slate-400 hover:text-red-600"
                                title="Odebrat"
                                onClick={async () => {
                                  if (!confirm("Odebrat položku?")) return;
                                  try {
                                    await api(`/events/${id}/reserve`, {
                                      method: "POST",
                                      body: JSON.stringify({ items: [{ inventoryItemId: r.inventoryItemId, qty: 0 }] })
                                    });
                                    toast.success("Odebráno");
                                    load();
                                  } catch (e: any) { toast.error(humanError(e)); }
                                }}
                              >
                                <Icons.Trash className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddItemsPanel
        open={addOpen}
        onOpenChange={(v) => {
          setAddOpen(v);
          if (!v) {
            setAddInitialSearch(undefined);
            setAddFocusItemId(undefined);
          }
        }}
        eventId={event.id}
        role={role}
        initialSearch={addInitialSearch}
        focusItemId={addFocusItemId}
        onDone={async () => {
          await load();
        }}
      />

      <ConfirmDialog
        open={exportConfirm}
        onOpenChange={setExportConfirm}
        title="Předat skladu (PDF)?"
        description="Vytvoří se export a sklad uvidí tuto verzi. Pokud později něco změníš, bude potřeba nová revize."
        confirmText="Vytvořit export"
        onConfirm={async () => {
          if (!id) return;
          try {
            const res = await api<{ pdfUrl: string }>(`/events/${id}/export`, { method: "POST", body: "{}" });
            toast.success("Export vytvořen");
            window.open(withToken(`${apiBaseUrl()}${res.pdfUrl}`), "_blank");
            await load();
          } catch (e: any) {
            toast.error(humanError(e));
          }
        }}
      />

      <ConfirmDialog
        open={chefConfirm}
        onOpenChange={setChefConfirm}
        title="Potvrdit kuchyň?"
        description="Tím se akce označí jako připravená pro sklad. Rozpracované rezervace se potvrdí."
        confirmText="Potvrdit"
        onConfirm={async () => {
          if (!id) return;
          try {
            await api(`/events/${id}/confirm-chef`, { method: "POST", body: "{}" });
            toast.success("Potvrzeno");
            await load();
          } catch (e: any) {
            toast.error(humanError(e));
          }
        }}
      />

      <ConfirmDialog
        open={cancelConfirm}
        onOpenChange={setCancelConfirm}
        tone="danger"
        title="Zrušit akci?"
        description="Zrušená akce uvolní rezervace pro jiné termíny. Historie zůstane zachovaná."
        confirmText="Zrušit"
        onConfirm={async () => {
          if (!id) return;
          try {
            await api(`/events/${id}/cancel`, { method: "POST", body: "{}" });
            toast.success("Akce zrušena");
            await load();
          } catch (e: any) {
            toast.error(humanError(e));
          }
        }}
      />

      <ConfirmDialog
        open={hardDeleteConfirm}
        onOpenChange={setHardDeleteConfirm}
        tone="danger"
        title="Smazat akci navždy?"
        description="POZOR: Toto nenávratně smaže celou akci a všechna data s ní spojená. Rezervace se zruší."
        confirmText="Smazat navždy"
        onConfirm={async () => {
          if (!id) return;
          try {
            await api(`/events/${id}`, { method: "DELETE" });
            toast.success("Akce smazána napořád");
            nav("/events");
          } catch (e: any) {
            toast.error(humanError(e));
          }
        }}
      />
    </div>
  );
}

function AddItemsPanel(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  role: string;
  onDone: () => void;
  initialSearch?: string;
  focusItemId?: string;
}) {
  const [parents, setParents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [availability, setAvailability] = useState<Map<string, StockRow>>(new Map());
  const initRef = useRef(false);
  const prefillRef = useRef(false);

  const isChef = props.role === "chef";

  const subcats = useMemo(() => {
    const p = parents.find((x) => x.id === parentId);
    return p?.children ?? [];
  }, [parents, parentId]);

  useEffect(() => {
    if (!props.open) return;
    initRef.current = false;
    prefillRef.current = false;
    api<{ parents: any[] }>("/categories/tree")
      .then((r) => {
        setParents(r.parents);
        if (isChef) {
          const tech = r.parents.find((p: any) => String(p.name).toLowerCase() === "kuchyň");
          if (tech) setParentId(tech.id);
        }
      })
      .catch(() => { });
  }, [props.open]);

  const load = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("active", "true");
      if (search) q.set("search", search);
      if (parentId) q.set("parent_category_id", parentId);
      if (categoryId) q.set("category_id", categoryId);
      const res = await api<{ items: any[] }>(`/inventory/items?${q.toString()}`);
      const slice = res.items.slice(0, 50);
      setItems(slice);
      const ids = slice.map((i: any) => i.id);
      if (ids.length) {
        const a = await api<{ rows: StockRow[] }>(`/events/${props.eventId}/availability`, {
          method: "POST",
          body: JSON.stringify({ inventory_item_ids: ids })
        });
        setAvailability(new Map(a.rows.map((x) => [x.inventoryItemId, x])));
      } else {
        setAvailability(new Map());
      }
    } catch (e: any) {
      toast.error(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!props.open) return;
    load();
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    if (initRef.current) return;
    initRef.current = true;
    if (props.initialSearch) setSearch(props.initialSearch);
  }, [props.open, props.initialSearch]);

  useEffect(() => {
    if (!props.open) return;
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [props.open, search, parentId, categoryId]);

  useEffect(() => {
    if (!props.open) return;
    if (!props.focusItemId) return;
    if (prefillRef.current) return;
    const a = availability.get(props.focusItemId);
    if (!a) return;
    const available = a.available ?? 0;
    prefillRef.current = true;
    if (available <= 0) return;
    setQty((prev) => {
      const existing = prev[props.focusItemId as string] ?? 0;
      const desired = existing > 0 ? existing : 1;
      return { ...prev, [props.focusItemId as string]: Math.min(available, desired) };
    });
  }, [props.open, props.focusItemId, availability]);

  const save = async () => {
    const list = Object.entries(qty)
      .map(([inventory_item_id, q]) => ({ inventory_item_id, qty: Number(q) }))
      .filter((x) => x.qty > 0);
    if (list.length === 0) {
      toast.error("Vyber aspoň jednu položku.");
      return;
    }
    try {
      await api(`/events/${props.eventId}/reserve`, {
        method: "POST",
        body: JSON.stringify({ items: list })
      });
      toast.success("Uloženo");
      setQty({});
      props.onOpenChange(false);
      props.onDone();
    } catch (e: any) {
      toast.error(humanError(e));
    }
  };

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Přidat položky"
      description="Zobrazujeme dostupnost pro termín této akce."
      primaryText="Uložit výběr"
      onPrimary={save}
      primaryDisabled={loading}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <label className="md:col-span-3 text-sm">
          Hledat
          <Input className="mt-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Název…" />
        </label>
        <label className="text-sm">
          Typ
          <Select
            className="mt-1"
            value={parentId}
            onChange={(e) => {
              setParentId(e.target.value);
              setCategoryId("");
            }}
            disabled={isChef}
          >
            <option value="">Vše</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Kategorie
          <Select className="mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!parentId}>
            <option value="">Vše</option>
            {subcats.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-end">
          <Button variant="secondary" full onClick={load}>
            Obnovit
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="rounded-2xl border border-slate-200 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-600">Žádné položky pro zvolené filtry.</div>
        ) : (
          items.map((i: any) => {
            const a = availability.get(i.id);
            const available = a?.available ?? 0;
            const unit = i.unit ?? "ks";
            const tone = stockTone(available);
            return (
              <div key={i.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{i.name}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {i.category?.parent?.name ?? ""} / {i.category?.name}
                    </div>
                    <div className="mt-2">
                      <div className={cn("text-sm font-semibold", tone === "ok" && "text-emerald-700", tone === "warn" && "text-amber-800", tone === "danger" && "text-red-700")}>
                        K dispozici pro tuto akci: {available} {unit}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Celkem: {a?.physicalTotal ?? 0} · Rezervováno: {a?.blockedTotal ?? 0}
                      </div>
                      {available === 0 ? (
                        <div className="mt-1 text-xs text-slate-500">Momentálně nedostupné (rezervováno na jiné akce).</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-28">
                    <label className="text-xs">
                      Množství
                      <Input
                        className="mt-1"
                        type="number"
                        min={0}
                        max={available}
                        disabled={available === 0}
                        value={qty[i.id] ?? 0}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(available, Number(e.target.value)));
                          setQty((prev) => ({ ...prev, [i.id]: v }));
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
