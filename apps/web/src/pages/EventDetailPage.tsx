import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, apiBaseUrl, apiUrl, getCurrentUser, getToken } from "../lib/api";
import { fromDateInputValue, fromDatetimeLocalValue, toDateInputValue, toDatetimeLocalValue } from "../lib/datetime";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Skeleton from "../components/ui/Skeleton";
import Textarea from "../components/ui/Textarea";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Modal from "../components/ui/Modal";
import EventLoadError from "../components/EventLoadError";
import CategorySidebar, { type CatalogCategory } from "../components/CategorySidebar";
import { FavoriteButton, FavoriteFilter, useInventoryFavorites } from "../components/InventoryFavorites";
import QuantityStepper from "../components/ui/QuantityStepper";
import SegmentedControl from "../components/ui/SegmentedControl";
import QuickAddItemsModal from "../components/QuickAddItemsModal";
import toast from "react-hot-toast";
import {
  canCreateEventExport,
  compareByCategoryParentName,
  formatCategoryParentLabel,
  humanError,
  managerLabel,
  statusBadgeClass,
  statusLabel,
  stockTone,
  warehouseWorkflowAction
} from "../lib/viewModel";
import { cn } from "../lib/ui";
import { dayRangeKey, dayRangeLabel, defaultDeliveryPickup, eventDayCount, eventDayDateLabel, reservationRowKey, sameDayRange, type DayRange } from "../lib/eventDays";
import EventDateFields from "../components/EventDateFields";
import { ArrowLeft, Ban, CalendarDays, Check, ChefHat, Copy, Ellipsis, ExternalLink, FileDown, LayoutGrid, List, MapPin, PackagePlus, Search, ShieldAlert, User, Wand2 } from "lucide-react";
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
  const idx = STATUS_STEPS.findIndex((status) => status === props.status);
  return (
    <ol aria-label="Průběh akce" className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-4 py-3.5 text-[13px] sm:gap-3">
      {STATUS_STEPS.map((status, index) => (
        <li key={status} aria-current={index === idx ? "step" : undefined} className={cn("flex items-center gap-2 whitespace-nowrap", index < STATUS_STEPS.length - 1 && "sm:flex-1", index > idx && "text-muted", index === idx && "font-semibold")}>
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full bg-canvas text-xs font-bold text-muted", index < idx && "bg-indigo-600 text-white", index === idx && "border border-indigo-600 bg-indigo-50 text-indigo-700")}>
            {index < idx ? <Check size={14} aria-label="Dokončeno" /> : index + 1}
          </span>
          {statusLabel(status)}
          {index < STATUS_STEPS.length - 1 && <span className={cn("hidden h-0.5 min-w-2 flex-1 bg-line sm:block", index < idx && "bg-indigo-600")} />}
        </li>
      ))}
    </ol>
  );
}

type ReservationRow = { inventoryItemId: string; reservedQuantity: number; state: string; item: { name?: string; unit?: string; imageUrl?: string | null; masterPackageQty?: number; category?: { name?: string; parent?: { name?: string } } }; createdById?: string; dayFrom: number; dayTo: number | null };

type StockRow = { inventoryItemId: string; physicalTotal: number; blockedTotal: number; available: number };

export default function EventDetailPage() {
  const currentUserId = getCurrentUser()?.id;
  const role = getCurrentUser()?.role ?? "";
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const deepLinkHandled = useRef("");

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadVersion = useRef(0);
  const [stockByItemId, setStockByItemId] = useState<Map<string, StockRow>>(new Map());

  const [addOpen, setAddOpen] = useState(false);
  const [addInitialSearch, setAddInitialSearch] = useState<string | undefined>(undefined);
  const [addFocusItemId, setAddFocusItemId] = useState<string | undefined>(undefined);
  const [exportConfirm, setExportConfirm] = useState(false);
  const [exportPreview, setExportPreview] = useState<any>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [chefConfirm, setChefConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState(false);
  const [crossSellWarnings, setCrossSellWarnings] = useState<any[]>([]);
  const [exportCrossSellAcknowledged, setExportCrossSellAcknowledged] = useState(false);
  const [editBasicsOpen, setEditBasicsOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [reservationFilter, setReservationFilter] = useState<"all" | "issues" | "manager" | "kitchen">("all");
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const pendingRows = useRef(new Set<string>());

  const load = async (opts?: { silent?: boolean }) => {
    if (!id) return;
    const version = ++loadVersion.current;
    if (!opts?.silent) setLoading(true);
    setLoadError("");
    try {
      const res = await api<{ event: any }>(`/events/${id}`);
      if (version !== loadVersion.current) return;
      setEvent(res.event);
      if (["DRAFT", "READY_FOR_WAREHOUSE", "SENT_TO_WAREHOUSE"].includes(res.event.status)) {
        api<{ warnings: any[] }>(`/events/${id}/cross-sell-warnings`)
          .then((w) => { if (version === loadVersion.current) setCrossSellWarnings(w.warnings); })
          .catch(() => {});
      } else {
        setCrossSellWarnings([]);
      }
    } catch (err) {
      if (version === loadVersion.current) setLoadError(humanError(err));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => { loadVersion.current++; };
  }, [id]);

  const reservationItems = useMemo<ReservationRow[]>(() => {
    const list = (event?.reservations ?? []).map((r: any) => ({
      inventoryItemId: r.inventoryItemId as string,
      reservedQuantity: Number(r.reservedQuantity),
      state: String(r.state),
      createdById: r.createdById as string,
      item: r.item,
      dayFrom: Number(r.dayFrom ?? 1),
      dayTo: (r.dayTo ?? null) as number | null
    }));
    return list;
  }, [event]);

  const reservationRowsKey = reservationItems.map((r) => reservationRowKey(r)).join(",");

  useEffect(() => {
    if (!id) return;
    setStockByItemId(new Map());
    if (reservationItems.length === 0) return;
    const controller = new AbortController();
    // Každý rozsah dnů má jiný interval, dostupnost se proto načítá po rozsazích.
    const groups = new Map<string, { range: DayRange; ids: string[] }>();
    for (const r of reservationItems) {
      const range = { dayFrom: r.dayFrom, dayTo: r.dayTo };
      const group = groups.get(dayRangeKey(range)) ?? { range, ids: [] };
      group.ids.push(r.inventoryItemId);
      groups.set(dayRangeKey(range), group);
    }
    Promise.all(
      Array.from(groups.values()).map((g) =>
        api<{ rows: StockRow[] }>(`/events/${id}/availability`, {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ inventory_item_ids: g.ids, day_from: g.range.dayFrom, day_to: g.range.dayTo })
        }).then((r) =>
          r.rows.map((x) => [reservationRowKey({ inventoryItemId: x.inventoryItemId, ...g.range }), x] as const)
        )
      )
    )
      .then((lists) => { if (!controller.signal.aborted) setStockByItemId(new Map(lists.flat())); })
      .catch(() => { });
    return () => controller.abort();
  }, [id, reservationRowsKey, event?.eventDate, event?.eventEndDate, event?.deliveryDatetime, event?.pickupDatetime]);

  const isPast = useMemo(() => {
    // Vícedenní akce je v minulosti až po posledním dni.
    const lastDay = event?.eventEndDate ?? event?.eventDate;
    if (!lastDay) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eDate = new Date(lastDay);
    eDate.setHours(0, 0, 0, 0);
    return eDate.getTime() < today.getTime();
  }, [event?.eventDate, event?.eventEndDate]);

  const canEM = ["admin", "event_manager", "chef", "warehouse"].includes(role);
  const canChef = ["admin", "chef"].includes(role);
  const canUseWarehouseWorkflow = role === "warehouse" || role === "admin";
  const canEditEvent = !isPast && event?.status !== "ISSUED" && event?.status !== "CLOSED" && event?.status !== "CANCELLED";
  const isOwner = Boolean(currentUserId && event?.createdBy?.id === currentUserId);
  // Sklad musi umet prihodit polozku do akce, kterou zalozil event manager:
  // ten v sezone casto vola z terenu, ze do akce jeste neco potrebuje.
  const canManageEvent = role === "admin" || role === "warehouse" || (["event_manager", "chef"].includes(role) && isOwner);
  // Kuchař dopisuje poznámku i do cizích akcí, ostatní údaje tam měnit nesmí.
  const canEditNotes = canManageEvent || role === "chef";
  const canConfirmKitchen = canChef || canManageEvent;

  // EM can add in DRAFT/READY/SENT_TO_WAREHOUSE. Chef and Admin can add also in SENT_TO_WAREHOUSE.
  const canAddItems =
    !isPast &&
    ((canManageEvent && ["DRAFT", "READY_FOR_WAREHOUSE", "SENT_TO_WAREHOUSE"].includes(event?.status)) || canChef) &&
    canEditEvent;
  useEffect(() => {
    if (!event || event.id !== id || deepLinkHandled.current === loc.key) return;
    const params = new URLSearchParams(loc.search);
    if (params.get("addItems") !== "1") return;
    deepLinkHandled.current = loc.key;
    if (canAddItems) {
      setAddInitialSearch(params.get("q") ?? undefined);
      setAddFocusItemId(params.get("focusItemId") ?? undefined);
      setAddOpen(true);
    } else {
      toast.error("Do této akce nelze přidávat položky.");
    }
    params.delete("addItems");
    params.delete("q");
    params.delete("focusItemId");
    const search = params.toString();
    nav({ pathname: loc.pathname, search: search ? "?" + search : "" }, { replace: true });
  }, [event, id, loc.key, loc.pathname, loc.search, canAddItems, nav]);

  // Novy export pouze znovu zachyti aktualni stav polozek. Musi jit vytvorit
  // i po datu akce, aby sklad dokazal napravit revizi a dokoncit pozdni vydej.
  // Samotne upravy polozek zustavaji u minulych akci zamcene pres canEditEvent.
  const canExportEvent = canCreateEventExport(event?.status);
  const warehouseAction = warehouseWorkflowAction(event?.status);

  const latestExport = event?.exports?.[0] ?? null;
  const manager = managerLabel(event?.createdBy);
  const token = getToken();
  const withToken = (url: string) => (token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url);

  const openExportPreview = async () => {
    if (!id || !canExportEvent) return;
    setExportLoading(true);
    try {
      const res = await api<{ preview: unknown }>(`/events/${id}/export-preview`);
      setExportPreview(res.preview);
      setExportConfirm(true);
    } catch (error: unknown) {
      toast.error(humanError(error));
    } finally {
      setExportLoading(false);
    }
  };

  const grouped = useMemo(() => {
    type Group = { parent: string; sub: string; rows: ReservationRow[] };
    const sections: Array<{ title: string; groups: Group[] }> = [
      { title: "Event Manager", groups: [] },
      { title: "Kuchyň", groups: [] },
    ];

    const groups = new Map<string, Group>();
    for (const r of reservationItems) {
      const parent = r.item?.category?.parent?.name ?? "Ostatní";
      const sub = r.item?.category?.name ?? "Nezařazeno";
      const key = `${parent}||${sub}`;
      const g = groups.get(key) ?? { parent, sub, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    for (const g of groups.values()) g.rows.sort((a, b) => String(a.item?.name ?? "").localeCompare(String(b.item?.name ?? ""), "cs") || a.dayFrom - b.dayFrom);

    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      return compareByCategoryParentName(a, b);
    });

    for (const g of sortedGroups) {
      if (String(g.parent).toLowerCase() === "kuchyň") {
        sections[1].groups.push(g);
      } else {
        sections[0].groups.push(g);
      }
    }
    return sections;
  }, [reservationItems]);
  const hasKitchenItems = grouped[1].groups.length > 0;

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

  if (!loading && (loadError || !event)) {
    return <EventLoadError message={loadError || "Akci se nepodařilo načíst."} back="/events" retry={() => void load()} />;
  }

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

  const missingRows = reservationItems.filter((row) => {
    const stock = stockByItemId.get(reservationRowKey(row));
    return stock && stock.available < row.reservedQuantity;
  });
  const itemCount = reservationItems.length;
  const kitchenCount = grouped[1].groups.reduce((sum, group) => sum + group.rows.length, 0);
  const totalPieces = reservationItems.reduce((sum, row) => sum + (row.item?.unit === "ks" ? row.reservedQuantity : 0), 0);
  const packages = reservationItems.reduce((sum, row) => sum + (row.item?.masterPackageQty ? Math.ceil(row.reservedQuantity / row.item.masterPackageQty) : 0), 0);
  const updateReservation = async (row: ReservationRow, quantity: number) => {
    const key = reservationRowKey(row);
    if (pendingRows.current.has(key)) return;
    pendingRows.current.add(key);
    setSavingRows(new Set(pendingRows.current));
    try {
      await api(`/events/${id}/reserve`, {
        method: "POST",
        body: JSON.stringify({ items: [{ inventory_item_id: row.inventoryItemId, qty: quantity, day_from: row.dayFrom, day_to: row.dayTo }] }),
      });
      await load({ silent: true });
      if (quantity === 0) toast.success("Odebráno");
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      pendingRows.current.delete(key);
      setSavingRows(new Set(pendingRows.current));
    }
  };
  const openPackingList = (type?: "general" | "kitchen") => {
    const pdf = latestExport?.pdfUrl;
    if (pdf) window.open(withToken(`${apiBaseUrl()}${pdf}${type ? `?type=${type}` : ""}`), "_blank");
    else if (latestExport?.pdfPath) window.open(`${apiBaseUrl()}/storage/${latestExport.pdfPath}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <button type="button" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink" onClick={() => nav("/events")}><ArrowLeft size={16} /> Akce</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title wrap-break-word">{event.name}</h1>
            <Badge className={statusBadgeClass(event.status)}>{statusLabel(event.status)}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} /> {new Date(event.deliveryDatetime).toLocaleString("cs-CZ")} – {new Date(event.pickupDatetime).toLocaleString("cs-CZ")}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin size={15} className="shrink-0" /> {event.location}</span>
            {manager && <span className="inline-flex items-center gap-1.5"><User size={15} className="shrink-0" /> {manager}</span>}
            <span className={cn("inline-flex items-center gap-1.5 font-medium", event.chefConfirmedAt ? "text-emerald-700" : "text-amber-800")}><ChefHat size={15} /> {event.chefConfirmedAt ? "Kuchyň potvrzena" : "Čeká na kuchyň"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canEM && <Button variant="secondary" onClick={() => setDuplicateOpen(true)}><Copy size={15} /> Kopírovat</Button>}
          {canEM && canExportEvent && (role !== "chef" || isOwner) && <Button variant={canUseWarehouseWorkflow && warehouseAction && !event.exportNeedsRevision ? "secondary" : "primary"} onClick={openExportPreview} disabled={exportLoading}><FileDown size={15} /> {exportLoading ? "Načítám…" : event.exportNeedsRevision ? "Aktualizovat předání" : "Předat skladu (PDF)"}</Button>}
          {canUseWarehouseWorkflow && warehouseAction && !event.exportNeedsRevision && <Button onClick={() => nav(`/warehouse/${id}`)}><Icons.Truck className="size-4" /> {warehouseAction.label}</Button>}
          {(canManageEvent || canConfirmKitchen || event.status === "CLOSED") && (
            <details className="relative">
              <summary aria-label="Další akce" title="Další akce" className="grid size-10 cursor-pointer list-none place-items-center rounded-[9px] border border-line bg-white hover:bg-table"><Ellipsis size={18} /></summary>
              <div className="absolute left-0 z-10 mt-1 grid w-64 gap-1 rounded-xl border border-line bg-white p-2 shadow-lg sm:right-0 sm:left-auto">
                {canManageEvent && <Button variant="ghost" onClick={() => setEditBasicsOpen(true)}><Icons.Edit /> Upravit údaje</Button>}
                {canConfirmKitchen && <Button variant="ghost" onClick={() => setChefConfirm(true)} disabled={!canEditEvent}><Wand2 size={15} /> {event.chefConfirmedAt ? "Potvrdit kuchyň znovu" : role === "event_manager" ? "Potvrdit kuchyň a předat skladu" : "Potvrdit kuchyň"}</Button>}
                {event.status === "CLOSED" && <>
                  <Button variant="ghost" onClick={() => window.open(withToken(`${apiBaseUrl()}/events/${id}/report-pdf`), "_blank")}>Stáhnout závěrečný report</Button>
                  <Button variant="ghost" onClick={() => window.open(withToken(`${apiBaseUrl()}/events/${id}/report-pdf?view=true`), "_blank")}>Otevřít závěrečný report</Button>
                </>}
                {canManageEvent && <Button variant="ghost" className="text-red-700" onClick={() => setCancelConfirm(true)} disabled={!canEditEvent}><Ban size={15} /> Zrušit akci</Button>}
                {role === "admin" && <Button variant="ghost" className="text-red-700" onClick={() => setHardDeleteConfirm(true)}><Icons.Trash /> Smazat (Admin)</Button>}
              </div>
            </details>
          )}
        </div>
      </div>
      <Stepper status={event.status} />

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

      {(crossSellWarnings?.length ?? 0) > 0 ? (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Icons.Alert className="mt-0.5 h-5 w-5 text-blue-800" />
                <div>
                  <div className="text-sm font-semibold text-blue-900">Doporučené položky (Cross-sell)</div>
                  <div className="mt-1 text-sm text-blue-800">
                    K některým položkám v akci vám doporučujeme zkontrolovat, zda nechybí:
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {crossSellWarnings.map((w) => (
                      <div key={w.itemId ?? w.id} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white p-2">
                        <span className="text-xs font-medium">{w.name}</span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setAddInitialSearch(w.name);
                              setAddFocusItemId(w.itemId ?? w.id);
                              setAddOpen(true);
                            }}
                          >
                            Přidat
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-600 hover:bg-blue-100"
                            onClick={async () => {
                              try {
                                await api(`/events/${id}/cross-sell-dismiss`, {
                                  method: "POST",
                                  body: JSON.stringify({ itemId: w.itemId ?? w.id })
                                });
                                setCrossSellWarnings((prev) => prev.filter((x) => (x.itemId ?? x.id) !== (w.itemId ?? w.id)));
                                toast.success("Potvrzeno");
                              } catch (e: any) {
                                toast.error("Chyba");
                              }
                            }}
                          >
                            Jsem si vědom
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {event.status === "CLOSED" && (event.issues?.length > 0) ? (
        <Card className="border-red-100 bg-red-50/30">
          <CardHeader>
            <div className="flex items-center gap-2 text-red-800">
              <ShieldAlert className="h-5 w-5" />
              <div className="text-sm font-semibold">Přehled ztrát, poškození a spotřeby</div>
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
                      {issue.issuedQuantity || 0} {issue.item?.unit} ({issue.type === "broken" ? "rozbito" : issue.type === "consumed" ? "spotřebováno" : "chybí"})
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">Položky <span className="ml-1 text-sm font-normal text-muted">{itemCount}</span></h2>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SegmentedControl label="Filtr položek" value={reservationFilter} onChange={setReservationFilter} options={[
                { value: "all", label: `Vše ${itemCount}` },
                { value: "issues", label: <span className="text-red-700">Problémy {missingRows.length}</span> },
                { value: "manager", label: `Event manager ${itemCount - kitchenCount}` },
                { value: "kitchen", label: `Kuchyň ${kitchenCount}` },
              ]} />
              {(canManageEvent || canChef) && <Button size="sm" variant="dark" onClick={() => setAddOpen(true)} disabled={!canAddItems}><PackagePlus size={15} /> Přidat z katalogu</Button>}
            </div>
          </CardHeader>
          {itemCount === 0 || (reservationFilter === "issues" && missingRows.length === 0) || (reservationFilter === "manager" && kitchenCount === itemCount) || (reservationFilter === "kitchen" && kitchenCount === 0) ? (
            <p className="p-5 text-sm text-muted">{reservationFilter === "issues" && canEditEvent && stockByItemId.size < itemCount ? "Načítám dostupnost…" : "Žádné položky v tomto výběru."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="work-table w-full sm:min-w-[575px] text-sm">
                <thead className="table-header max-sm:sr-only">
                  <tr><th scope="col">Položka</th><th scope="col">Kategorie</th><th scope="col">Množství</th><th scope="col">{canEditEvent ? "Dostupné v termínu" : "Výdej"}</th><th scope="col">Balení</th><th scope="col" aria-label="Akce" /></tr>
                </thead>
                {grouped.map((section, sectionIndex) => {
                  if (reservationFilter === "manager" && sectionIndex !== 0 || reservationFilter === "kitchen" && sectionIndex !== 1) return null;
                  return section.groups.map((group) => {
                    const shown = reservationFilter === "issues" ? group.rows.filter((row) => missingRows.includes(row)) : group.rows;
                    if (!shown.length) return null;
                    return <tbody className="divide-y divide-line border-t border-line" key={`${group.parent}/${group.sub}`}>
                      <tr className="bg-table"><th scope="rowgroup" colSpan={6} className="px-4 py-2 text-left text-xs font-semibold text-muted">{group.parent} · {group.sub}</th></tr>
                      {shown.map((row) => {
                        const key = reservationRowKey(row);
                        const stock = stockByItemId.get(key);
                        const short = stock ? Math.max(0, row.reservedQuantity - Math.max(0, stock.available)) : 0;
                        const step = row.item?.masterPackageQty || 1;
                        const canChange = canEditEvent && (role === "admin" || role === "warehouse" ||
                          (["event_manager", "chef"].includes(role) && row.createdById === currentUserId) ||
                          (role === "chef" && group.parent.toLowerCase() === "kuchyň"));
                        const saving = savingRows.has(key);
                        const label = row.item?.name ?? "Položka";
                        return <tr key={key} className={cn("reservation-line", short > 0 && canEditEvent && "bg-red-50/60")}>
                          <td className="px-4 py-2"><div className="flex items-center gap-2">
                            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">{row.item?.imageUrl ? <img className="size-full object-cover" src={apiUrl(row.item.imageUrl)} alt="" loading="lazy" /> : <Icons.Image className="size-4" />}</span>
                            <div className="min-w-0"><span className="font-medium">{label}</span>{event.dayCount > 1 && <div className="text-xs text-muted">{dayRangeLabel(row, event.dayCount)}</div>}</div>
                          </div></td>
                          <td className="px-4 py-2 text-xs text-muted">{group.sub}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{canChange ?
                            <QuantityStepper label={label} value={row.reservedQuantity} onDecrease={() => void updateReservation(row, Math.max(1, row.reservedQuantity - step))} onIncrease={() => void updateReservation(row, row.reservedQuantity + step)} decreaseDisabled={saving || row.reservedQuantity <= step} increaseDisabled={saving || !!stock && row.reservedQuantity + step > stock.available} /> :
                            <strong>{row.reservedQuantity} {row.item?.unit}</strong>}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">{canEditEvent ?
                            stock ? <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", short > 0 ? "text-red-700" : stock.available - row.reservedQuantity <= 3 ? "text-amber-800" : "text-emerald-700")}><span className="size-2 rounded-full bg-current" />{short > 0 ? `Chybí ${short}` : `Volné: ${stock.available}`} {row.item?.unit}</span> : <span className="text-xs text-muted">–</span> :
                            <div className="text-xs text-muted">{issueData.issuedMap.has(row.inventoryItemId) && <div>Vydáno {issueData.issuedMap.get(row.inventoryItemId)} {row.item?.unit}</div>}{!!issueData.lostMap.get(row.inventoryItemId) && <div className="text-amber-800">Ztráty {issueData.lostMap.get(row.inventoryItemId)} {row.item?.unit}</div>}</div>}
                          </td>
                          <td className="px-4 py-2 text-xs whitespace-nowrap text-muted">{row.item?.masterPackageQty ? `${Math.ceil(row.reservedQuantity / row.item.masterPackageQty)} bal.` : "–"}</td>
                          <td className="py-2 pr-3 text-right">{canChange && <button type="button" title="Odebrat položku" aria-label={`Odebrat ${label}`} className="rounded-md p-1.5 text-muted hover:bg-red-100 hover:text-red-700 disabled:opacity-50" disabled={saving} onClick={() => { if (window.confirm("Odebrat položku?")) void updateReservation(row, 0); }}><Icons.Trash /></button>}</td>
                        </tr>;
                      })}
                    </tbody>;
                  });
                })}
              </table>
            </div>
          )}
        </Card>

        <aside className="space-y-4" aria-label="Souhrn akce">
          {canEditEvent && <Card className="space-y-3 p-4">
            <h2 className="font-bold">Připravenost k výdeji</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Dostupné</dt><dd className="font-semibold text-emerald-700">{stockByItemId.size - missingRows.length} / {itemCount}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">K vyřešení</dt><dd className={cn("font-semibold", missingRows.length > 0 && "text-red-700")}>{missingRows.length}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Kusů celkem</dt><dd className="font-semibold">{totalPieces}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Balení</dt><dd className="font-semibold">{packages || "–"}</dd></div>
            </dl>
            {missingRows.length > 0 && <button onClick={() => setReservationFilter(reservationFilter === "issues" ? "all" : "issues")} type="button" className="w-full rounded-lg bg-red-100 p-3 text-left text-sm font-semibold text-red-700 hover:underline">Zobrazit nedostupné položky ({missingRows.length})</button>}
          </Card>}
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Poznámka pro sklad</h2>{canEditNotes && <button type="button" aria-label={canManageEvent ? "Upravit údaje akce" : "Upravit poznámku"} className="rounded-md p-1.5 text-muted hover:bg-canvas" onClick={() => setEditBasicsOpen(true)}><Icons.Edit /></button>}</div>
            <p className="text-sm whitespace-pre-wrap text-muted">{event.notes || "Bez poznámky."}</p>
            {event.registrationNumber && <div className="text-xs text-muted">Evidenční číslo {event.registrationNumber}</div>}
            {(event.palletCount != null || event.totalWeight) && <p className="text-xs text-muted">{[event.palletCount != null ? `Palety ${event.palletCount}` : null, event.totalWeight ? `Váha ${event.totalWeight}` : null].filter(Boolean).join(" · ")}</p>}
          </Card>
          {(latestExport?.pdfUrl || latestExport?.pdfPath || role === "chef") && <Card className="space-y-2 p-4">
            <h2 className="font-bold">Balicí listy</h2>
            {role === "chef" && <Button className="w-full justify-between" variant="ghost" disabled={!hasKitchenItems} onClick={() => window.open(withToken(`${apiBaseUrl()}/events/${event.id}/kitchen-pdf`), "_blank")}>Kuchyň · aktuální <ExternalLink size={14} /></Button>}
            {(latestExport?.pdfUrl || latestExport?.pdfPath) && <>
              {role !== "chef" && <Button className="w-full justify-between" variant="ghost" onClick={() => openPackingList()}>Komplet <ExternalLink size={14} /></Button>}
              <Button className="w-full justify-between" variant="ghost" onClick={() => openPackingList("general")}>Sklad <ExternalLink size={14} /></Button>
              {role !== "chef" && <Button className="w-full justify-between" variant="ghost" onClick={() => openPackingList("kitchen")}>Kuchyň <ExternalLink size={14} /></Button>}
              {latestExport?.version && <p className="text-xs text-muted">Poslední export v{latestExport.version} · {new Date(latestExport.exportedAt).toLocaleString("cs-CZ")}</p>}
            </>}
          </Card>}
        </aside>
      </div>

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
        eventName={event.name}
        eventLocation={event.location}
        role={role}
        existingItems={reservationItems}
        dayCount={event.dayCount ?? 1}
        eventDate={event.eventDate ?? null}
        initialSearch={addInitialSearch}
        focusItemId={addFocusItemId}
        onDone={() => load({ silent: true })}
      />

      <Modal
        open={exportConfirm}
        onOpenChange={(v) => {
          setExportConfirm(v);
          if (!v) {
            setExportPreview(null);
            setExportCrossSellAcknowledged(false);
          }
        }}
        title="Náhled exportu"
        description="Zkontrolujte obsah před předáním do skladu."
        primaryText="Vytvořit export"
        primaryDisabled={crossSellWarnings.length > 0 && !exportCrossSellAcknowledged}
        onPrimary={async () => {
          if (!id) return;
          try {
            const res = await api<{ pdfUrl: string }>(`/events/${id}/export`, { method: "POST", body: "{}" });
            toast.success("Export vytvořen");
            setExportConfirm(false);
            setExportPreview(null);
            window.open(withToken(`${apiBaseUrl()}${res.pdfUrl}`), "_blank");
            await load();
          } catch (e: any) {
            toast.error(humanError(e));
          }
        }}
      >
        {exportPreview ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div><span className="text-slate-500">Název:</span> <strong>{exportPreview.event?.name}</strong></div>
              <div><span className="text-slate-500">Místo:</span> {exportPreview.event?.location}</div>
              {exportPreview.event?.address && <div><span className="text-slate-500">Adresa:</span> {exportPreview.event?.address}</div>}
              {exportPreview.event?.eventDate && (
                <div>
                  <span className="text-slate-500">Datum akce:</span> {new Date(exportPreview.event.eventDate).toLocaleDateString("cs-CZ")}
                  {exportPreview.event.eventEndDate && exportPreview.event.eventEndDate !== exportPreview.event.eventDate
                    ? ` - ${new Date(exportPreview.event.eventEndDate).toLocaleDateString("cs-CZ")}`
                    : ""}
                </div>
              )}
              <div><span className="text-slate-500">Doručení:</span> {new Date(exportPreview.event?.deliveryDatetime).toLocaleString("cs-CZ")}</div>
              <div><span className="text-slate-500">Svoz:</span> {new Date(exportPreview.event?.pickupDatetime).toLocaleString("cs-CZ")}</div>
            </div>
            {exportPreview.event?.notes ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                <div className="text-xs font-semibold text-slate-500 mb-1">Poznámka</div>
                {exportPreview.event.notes}
              </div>
            ) : null}
            {crossSellWarnings.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-semibold text-amber-900">Ještě chybí doporučené položky</div>
                <div className="mt-1 text-sm text-amber-800">
                  U některých položek není v akci přidaný související cross-sell. Buď je doplňte, nebo potvrďte, že o tom víte.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {crossSellWarnings.map((warning) => (
                    <span key={warning.itemId ?? warning.id} className="rounded-full border border-amber-200 bg-white px-2 py-1 text-xs font-medium text-amber-900">
                      {warning.name}
                    </span>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    checked={exportCrossSellAcknowledged}
                    onChange={(e) => setExportCrossSellAcknowledged(e.target.checked)}
                    className="h-4 w-4 rounded border-amber-300"
                  />
                  Jsem si vědom, že doporučené položky nejsou přidané, a chci pokračovat.
                </label>
              </div>
            ) : null}
            <div className="border-t pt-3">
              <div className="mb-2 font-semibold">Položky k zabalení ({exportPreview.itemCount})</div>
              {exportPreview.groups?.map((g: any, i: number) => (
                <div key={i} className="mb-3">
                  <div className="text-xs font-medium text-slate-500">
                    {formatCategoryParentLabel(g.parentCategory, g.category)}
                  </div>
                  <ul className="ml-4 list-disc">
                    {g.items?.map((item: any, j: number) => (
                      <li key={j}>
                        {item.name}
                        {exportPreview.event?.dayCount > 1 ? ` (${dayRangeLabel({ dayFrom: item.dayFrom ?? 1, dayTo: item.dayTo ?? null }, exportPreview.event.dayCount)})` : ""}
                        {" "}— <strong>{item.qty} {item.unit}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-slate-500">Načítám náhled...</div>
        )}
      </Modal>

      <ConfirmDialog
        open={chefConfirm}
        onOpenChange={setChefConfirm}
        title="Potvrdit kuchyň?"
        description={
          role === "event_manager"
            ? "Tím se kuchyňské vybavení potvrdí a akce se připraví k vydání skladníkem. Rozpracované rezervace se potvrdí."
            : "Tím se akce označí jako připravená pro sklad. Rozpracované rezervace se potvrdí."
        }
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
      {editBasicsOpen && event && (
        <EditBasicsModal
          open={editBasicsOpen}
          onOpenChange={(v) => setEditBasicsOpen(v)}
          event={event}
          notesOnly={!canManageEvent}
          onDone={() => load({ silent: true })}
        />
      )}
      {duplicateOpen && event && (
        <DuplicateEventModal
          open={duplicateOpen}
          onOpenChange={(v) => setDuplicateOpen(v)}
          event={event}
        />
      )}
    </div>

  );
}

function AddItemsPanel(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  eventName: string;
  eventLocation: string;
  role: string;
  existingItems: Array<{ inventoryItemId: string; reservedQuantity: number; item: any; createdById?: string; dayFrom: number; dayTo: number | null }>;
  dayCount: number;
  eventDate: string | null;
  onDone: () => void;
  initialSearch?: string;
  focusItemId?: string;
}) {
  const [parents, setParents] = useState<CatalogCategory[]>([]);
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [currentItems, setCurrentItems] = useState<Array<{ inventoryItemId: string; reservedQuantity: number; item: any; createdById?: string; dayFrom: number; dayTo: number | null }>>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [crossSells, setCrossSells] = useState<{ sourceItem: any, items: any[] } | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [availability, setAvailability] = useState<Map<string, StockRow>>(new Map());
  // Dostupnost je jedno cislo za vsechny sklady dohromady. Manazer ale potrebuje
  // vedet, kde polozka lezi - vydej mimo domaci sklad znamena dalsi cestu.
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; isHome?: boolean }>>([]);
  const [warehouseStocks, setWarehouseStocks] = useState<Record<string, Record<string, number>>>({});
  const [view, setView] = useState<"grid" | "list">("grid");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useInventoryFavorites();
  const [catalogSort, setCatalogSort] = useState<"category" | "name" | "available">("category");
  const [catalogLimit, setCatalogLimit] = useState(50);
  const [catalogError, setCatalogError] = useState("");
  const pending = useRef(new Set<string>());
  const initRef = useRef(false);
  const prefillRef = useRef(false);
  const loadSeq = useRef(0);

  const userId = getCurrentUser()?.id;

  // U vícedenní akce EM volí, pro které dny zadává počty. Panel pak ukazuje
  // jen řádky tohoto rozsahu a dostupnost pro něj.
  const [range, setRange] = useState<DayRange>({ dayFrom: 1, dayTo: null });
  const rangeKey = dayRangeKey(range);
  const rangeKeyRef = useRef(rangeKey);
  rangeKeyRef.current = rangeKey;
  const dayNumbers = useMemo(() => Array.from({ length: props.dayCount }, (_, i) => i + 1), [props.dayCount]);
  const dayOptionLabel = (d: number) => (props.eventDate ? `Den ${d} (${eventDayDateLabel(props.eventDate, d)})` : `Den ${d}`);

  useEffect(() => {
    if (!props.open) setRange({ dayFrom: 1, dayTo: null });
  }, [props.open]);

  useEffect(() => {
    setQty({});
    setAvailability(new Map());
  }, [rangeKey]);

  useEffect(() => {
    setCatalogLimit(50);
  }, [props.open, search, parentId, categoryId, rangeKey, onlyAvailable, favoritesOnly, catalogSort]);

  const subcats = useMemo(() => {
    if (parentId) {
      const p = parents.find((x: any) => x.id === parentId);
      return (p?.children ?? []).map((c: any) => ({ ...c, parentName: p?.name ?? "" }));
    }
    return parents.flatMap((p: any) =>
      (p.children ?? []).map((c: any) => ({ ...c, parentName: p.name }))
    );
  }, [parents, parentId]);

  useEffect(() => {
    if (!props.open) return;
    const nextItems = props.existingItems.filter(
      (r) => Number(r.reservedQuantity) > 0 && sameDayRange({ dayFrom: r.dayFrom, dayTo: r.dayTo }, range)
    );
    setCurrentItems(nextItems);
    setQty((prev) => {
      const next = { ...prev };
      for (const item of nextItems) {
        next[item.inventoryItemId] = Number(item.reservedQuantity);
      }
      return next;
    });
  }, [props.open, props.existingItems, rangeKey]);

  useEffect(() => {
    if (!props.open) {
      setQuickAddOpen(false);
      setFavoritesOnly(false);
      return;
    }
    initRef.current = false;
    prefillRef.current = false;
    setLoading(true);
    api<{ parents: CatalogCategory[] }>("/categories/tree")
      .then((r) => setParents(r.parents))
      .catch(() => { });
  }, [props.open]);

  const load = async () => {
    setLoading(true);
    setCatalogError("");
    const seq = ++loadSeq.current;
    try {
      const q = new URLSearchParams();
      q.set("active", "true");
      if (search) q.set("search", search);
      if (parentId) q.set("parent_category_id", parentId);
      if (categoryId) q.set("category_id", categoryId);
      const res = await api<{ items: any[] }>(`/inventory/items?${q.toString()}`);
      if (seq !== loadSeq.current) return;
      setItems(res.items);
      const reservedIds = props.existingItems
        .filter((item) => item.reservedQuantity > 0 && sameDayRange(item, range))
        .map((item) => item.inventoryItemId);
      const ids = [...new Set<string>([...res.items.map((item) => item.itemId ?? item.id), ...reservedIds])];
      if (ids.length) {
        const batches = Array.from({ length: Math.ceil(ids.length / 1000) }, (_, index) =>
          api<{ rows: StockRow[] }>(`/events/${props.eventId}/availability`, {
            method: "POST",
            body: JSON.stringify({ inventory_item_ids: ids.slice(index * 1000, index * 1000 + 1000), day_from: range.dayFrom, day_to: range.dayTo })
          })
        );
        const responses = await Promise.all(batches);
        if (seq !== loadSeq.current) return;
        setAvailability(new Map(responses.flatMap(({ rows }) => rows.map((row) => [row.inventoryItemId, row] as const))));

        const warehousesResult = await Promise.all([
          api<{ warehouses: Array<{ id: string; name: string; isHome?: boolean }> }>("/warehouses"),
          api<{ stocks: Record<string, Record<string, number>> }>("/inventory/warehouse-stocks")
        ]).catch(() => null);
        if (seq === loadSeq.current && warehousesResult) {
          const [wh, ws] = warehousesResult;
          setWarehouses(wh.warehouses);
          setWarehouseStocks(ws.stocks);
        }
      } else {
        setAvailability(new Map());
      }
    } catch (err) {
      if (seq === loadSeq.current) {
        setItems([]);
        setAvailability(new Map());
        setCatalogError(humanError(err));
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!props.open) return;
    if (initRef.current) return;
    initRef.current = true;
    if (props.initialSearch) setSearch(props.initialSearch);
  }, [props.open, props.initialSearch]);

  useEffect(() => {
    if (!props.open) return;
    setLoading(true);
    const t = setTimeout(load, 300);
    return () => {
      clearTimeout(t);
      loadSeq.current++;
    };
  }, [props.open, search, parentId, categoryId, rangeKey]);

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

  const applyReservation = async (params: { inventoryItemId: string; qty: number; item?: any; createdById?: string }) => {
    const normalizedQty = Math.max(0, Math.floor(Number(params.qty) || 0));
    const existing = currentItems.find((r) => r.inventoryItemId === params.inventoryItemId);
    if (!existing && normalizedQty <= 0) return;
    if (existing && normalizedQty === Number(existing.reservedQuantity)) return;

    const savedRangeKey = rangeKey;
    if (pending.current.has(params.inventoryItemId)) return;
    pending.current.add(params.inventoryItemId);
    setSaving((prev) => ({ ...prev, [params.inventoryItemId]: true }));
    try {
      const res = await api<{ masterPackageAdjustments?: any[] }>(`/events/${props.eventId}/reserve`, {
        method: "POST",
        body: JSON.stringify({
          items: [{ inventory_item_id: params.inventoryItemId, qty: normalizedQty, day_from: range.dayFrom, day_to: range.dayTo }]
        })
      });

      const adj = res.masterPackageAdjustments?.find((a) => a.inventoryItemId === params.inventoryItemId);
      const finalQty = adj ? adj.adjustedQty : normalizedQty;

      // Rozsah se mohl během ukládání změnit, pak lokální stav panelu neměníme.
      if (rangeKeyRef.current === savedRangeKey) {
      setCurrentItems((prev) => {
        const found = prev.find((r) => r.inventoryItemId === params.inventoryItemId);
        if (finalQty <= 0) {
          return prev.filter((r) => r.inventoryItemId !== params.inventoryItemId);
        }
        const nextItem = {
          inventoryItemId: params.inventoryItemId,
          reservedQuantity: finalQty,
          dayFrom: range.dayFrom,
          dayTo: range.dayTo,
          item: params.item ?? found?.item,
          createdById: found?.createdById ?? params.createdById ?? userId
        };
        if (found) {
          return prev.map((r) => (r.inventoryItemId === params.inventoryItemId ? { ...r, ...nextItem } : r));
        }
        return [...prev, nextItem];
      });
      setQty((prev) => ({ ...prev, [params.inventoryItemId]: finalQty }));
      }

      void props.onDone();

      if (finalQty <= 0) {
        toast.success("Odebráno");
      } else if (existing) {
        toast.success("Aktualizováno");
      } else {
        toast.success("Přidáno");
      }

      if (adj) {
        toast.success((t) => (
          <div>
            <div className="font-semibold">{params.item?.name}</div>
            Množství bylo zaokrouhleno z {adj.requestedQty} na <strong className="font-bold">{adj.adjustedQty}</strong> (celá balení).
          </div>
        ), { duration: 5000 });
      }

      if (!existing && finalQty > 0) {
        const presentItemIds = new Set([
          params.inventoryItemId,
          ...currentItems
            .filter((item) => Number(item.reservedQuantity) > 0)
            .map((item) => item.inventoryItemId)
        ]);
        api<{ items: any[] }>(`/events/${props.eventId}/cross-sells/${params.inventoryItemId}`)
          .then((r) => {
            const missingCrossSells = (r.items ?? []).filter((item: any) => {
              const itemId = item.itemId ?? item.id;
              return !presentItemIds.has(itemId);
            });
            if (missingCrossSells.length > 0) {
              setCrossSells({ sourceItem: params.item, items: missingCrossSells });
            }
          })
          .catch(() => {});
      }
    } catch (e: any) {
      toast.error(humanError(e));
    } finally {
      pending.current.delete(params.inventoryItemId);
      setSaving((prev) => ({ ...prev, [params.inventoryItemId]: false }));
    }
  };

  const activeItems = currentItems.filter((r) => Number(r.reservedQuantity) > 0);

  const canModifyReservation = (row: (typeof currentItems)[number]) => {
    const parent = String(row.item?.category?.parent?.name ?? "").toLowerCase();
    return props.role === "admin" ||
      (["event_manager", "chef", "warehouse"].includes(props.role) && (!row.createdById || row.createdById === userId)) ||
      (props.role === "chef" && parent === "kuchyň");
  };
  const activeGroups = new Map<string, typeof activeItems>();
  for (const row of [...activeItems].sort(compareByCategoryParentName)) {
    const category = row.item?.category?.parent?.name ?? row.item?.category?.name ?? row.item?.category?.sub?.name ?? "Ostatní";
    const group = activeGroups.get(category) ?? [];
    group.push(row);
    activeGroups.set(category, group);
  }
  const catalogItems = items
    .filter((item) => !favoritesOnly || favorites?.ids?.has(item.itemId ?? item.id))
    .filter((item) => !onlyAvailable || (availability.get(item.itemId ?? item.id)?.available ?? 0) > 0)
    .sort((a, b) => {
      if (catalogSort === "available") return (availability.get(b.itemId ?? b.id)?.available ?? 0) - (availability.get(a.itemId ?? a.id)?.available ?? 0);
      return catalogSort === "name" ? a.name.localeCompare(b.name, "cs") : compareByCategoryParentName(a, b);
    });
  const unavailable = activeItems.filter((row) => {
    const stock = availability.get(row.inventoryItemId);
    return stock && stock.available < Number(row.reservedQuantity);
  });
  const selectedParent = parents.find((category) => category.id === parentId);
  const selectedSub = subcats.find((category) => category.id === categoryId);
  const selectParent = (id: string) => { setParentId(id); setCategoryId(""); };

  return (
    <>
      <Modal open={props.open} onOpenChange={props.onOpenChange} title="Přidáváte do akce"
        description={ [props.eventName, props.eventDate ? eventDayDateLabel(props.eventDate, 1) : null, props.eventLocation].filter(Boolean).join(" · ") }
        fullScreen closeText="Hotovo, zpět na akci">
        <div className="grid min-h-full lg:h-full lg:grid-cols-[170px_minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_minmax(300px,26%)]">
          <aside className="hidden border-r border-line bg-white p-4 lg:block lg:overflow-y-auto">
            <CategorySidebar categories={parents} parentId={parentId} categoryId={categoryId} onParent={selectParent} onCategory={setCategoryId} />
          </aside>
          <section className="min-w-0 space-y-3 bg-canvas p-4 lg:overflow-y-auto xl:p-6" aria-label="Katalog položek">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-42 flex-1">
                <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <Input className="pl-9" aria-label="Hledat v katalogu" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hledat název, kód nebo štítek…" />
              </label>
              <FavoriteFilter selected={favoritesOnly} onChange={setFavoritesOnly} />
              <label className="flex h-10 items-center gap-1.5 rounded-[9px] border border-line bg-white px-2.5 text-sm"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /> Jen dostupné</label>
              <Select className="w-auto max-w-44" aria-label="Řazení katalogu" value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as typeof catalogSort)}>
                <option value="category">Podle kategorie</option><option value="name">Podle názvu</option><option value="available">Podle dostupnosti</option>
              </Select>
              <SegmentedControl value={view} onChange={setView} label="Zobrazení katalogu" options={[
                { value: "grid", label: <><LayoutGrid size={15} /><span className="sr-only">Dlaždice</span></> },
                { value: "list", label: <><List size={15} /><span className="sr-only">Seznam</span></> },
              ]} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
              <Select aria-label="Hlavní kategorie" value={parentId} onChange={(event) => selectParent(event.target.value)}><option value="">Všechny kategorie</option>{parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</Select>
              <Select aria-label="Podkategorie" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Všechny podkategorie</option>{subcats.map((category) => <option key={category.id} value={category.id}>{parentId ? category.name : `${category.parentName} / ${category.name}`}</option>)}</Select>
            </div>
          {props.dayCount > 1 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
              <span className="font-semibold text-amber-950">Zadávám pro dny:</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
                value={range.dayFrom}
                onChange={(e) => {
                  const from = Number(e.target.value);
                  setRange((r) => {
                    const to = r.dayTo !== null && r.dayTo < from ? from : r.dayTo;
                    return { dayFrom: from, dayTo: to !== null && to >= props.dayCount ? null : to };
                  });
                }}
              >
                {dayNumbers.map((d) => (
                  <option key={d} value={d}>{dayOptionLabel(d)}</option>
                ))}
              </select>
              <span className="text-amber-900">až</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
                value={range.dayTo ?? props.dayCount}
                onChange={(e) => {
                  const to = Number(e.target.value);
                  setRange((r) => ({ dayFrom: r.dayFrom, dayTo: to >= props.dayCount ? null : to }));
                }}
              >
                {dayNumbers.filter((d) => d >= range.dayFrom).map((d) => (
                  <option key={d} value={d}>{dayOptionLabel(d)}</option>
                ))}
              </select>
              <span className="text-xs text-amber-800">
                Stejná položka může mít na jiné dny jiný počet. Volné množství platí pro zvolené dny.
              </span>
            </div>
          ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-lg font-bold">{favoritesOnly ? "Oblíbené položky" : [selectedParent?.name, selectedSub?.name].filter(Boolean).join(" › ") || "Katalog"}</h3><p className="text-xs text-muted">{catalogItems.length} položek · Dostupnost pro vybraný termín</p></div>
              <Button size="sm" variant="secondary" onClick={() => setQuickAddOpen(true)}>Rychlé zadání</Button>
            </div>
            <div className={cn(view === "grid" ? "grid grid-cols-2 gap-3 xl:grid-cols-3 min-[1380px]:grid-cols-4" : "space-y-2")}>
              {loading ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-36" />) : catalogError ? (
                <div className="col-span-full rounded-xl border border-line bg-white p-4 text-sm">
                  <p role="alert" className="mb-2 text-red-700">{catalogError}</p>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>Zkusit znovu</Button>
                </div>
              ) : catalogItems.length === 0 ? (
                <p className="col-span-full rounded-xl border border-line bg-white p-4 text-sm text-muted">
                  {favoritesOnly && favorites?.ids?.size === 0
                    ? "Zatím nemáte žádné oblíbené položky. Vypněte filtr a u vybrané položky zvolte Přidat do oblíbených."
                    : "Žádné položky pro zvolené filtry."}
                </p>
              ) : catalogItems.slice(0, catalogLimit).map((item) => {
                const itemId = item.itemId ?? item.id;
                const stock = availability.get(itemId);
                const available = stock?.available ?? 0;
                const existing = activeItems.find((row) => row.inventoryItemId === itemId);
                const reserved = Number(existing?.reservedQuantity ?? 0);
                const unit = item.unit ?? "ks";
                const step = Number(item.masterPackageQty) || 1;
                const locked = !!existing && !canModifyReservation(existing);
                return <Card key={itemId} className={cn("min-w-0 overflow-hidden", reserved > 0 && "border-indigo-600 ring-1 ring-indigo-600", view === "list" && "flex")}>
                  <div className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-[#eceff2] text-slate-400", view === "grid" ? "aspect-[1.3] w-full" : "w-24 sm:w-32")}>
                    {item.imageUrl ? <img className="size-full object-cover" loading="lazy" src={apiUrl(item.imageUrl)} alt="" /> : <Icons.Image className="size-6" />}
                    {view === "grid" && <Badge className="absolute top-2 left-2 max-w-[calc(100%-1rem)]" tone={stockTone(available)}>{available > 0 ? `Skladem ${available} ${unit}` : "Nedostupné"}</Badge>}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2 p-2.5 sm:p-3">
                    <div><h4 className="text-sm font-semibold wrap-break-word">{item.name}</h4><p className="text-xs text-muted">{formatCategoryParentLabel(item.category?.parent?.name, item.category?.sub?.name)}{stock ? ` · celkem ${stock.physicalTotal}` : ""}</p></div>
                    {view === "list" && <Badge tone={stockTone(available)}>{available > 0 ? `Skladem ${available} ${unit}` : "Nedostupné"}</Badge>}
                    {reserved > 0 ? (
                      <QuantityStepper label={item.name} value={<span className="text-indigo-700">{reserved} {unit}</span>} className="border-indigo-100 bg-indigo-50"
                        onDecrease={() => void applyReservation({ inventoryItemId: itemId, qty: Math.max(0, reserved - step), item, createdById: existing?.createdById })}
                        onIncrease={() => void applyReservation({ inventoryItemId: itemId, qty: reserved + step, item, createdById: existing?.createdById })}
                        decreaseDisabled={locked || saving[itemId]} increaseDisabled={locked || saving[itemId] || reserved + step > available} />
                    ) : <div className="flex flex-wrap items-center gap-2">
                      {view === "list" && <Input type="number" min={1} max={available} aria-label={"Počet k přidání — " + item.name}
                        className="h-9 w-20" value={qty[itemId] || ""} placeholder="Počet" disabled={available <= 0 || saving[itemId]}
                        onChange={(event) => setQty((previous) => ({ ...previous, [itemId]: Math.min(available, Math.max(0, Number(event.target.value))) }))} />}
                      <Button variant="dark" size="sm" className={cn("px-2", view === "grid" && "w-full")} disabled={available <= 0 || saving[itemId]} onClick={() => {
                      const initial = Math.max(step, Number(qty[itemId] || 0));
                      void applyReservation({ inventoryItemId: itemId, qty: Math.min(initial, available), item, createdById: userId });
                      }}><Icons.Plus className="size-3.5 shrink-0" /> Přidat do akce</Button>
                    </div>}
                    <FavoriteButton itemId={itemId} itemName={item.name} showLabel className={view === "grid" ? "w-full" : undefined} />
                    {view === "list" && <WarehouseBreakdown stocks={warehouseStocks[itemId]} warehouses={warehouses} />}
                  </div>
                </Card>;
              })}
            </div>
            {!loading && !catalogError && catalogItems.length > catalogLimit && (
              <Button type="button" variant="secondary" onClick={() => setCatalogLimit((limit) => limit + 50)}>
                Načíst další položky
              </Button>
            )}
          </section>
          <aside className="min-w-0 border-line bg-white lg:overflow-y-auto lg:border-l" aria-label="Položky v akci">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-4 py-3.5"><h3 className="font-bold">Položky v akci</h3><span className="text-xs text-muted">{activeItems.length} položek</span></div>
            {unavailable.length > 0 && <div className="bg-red-100 px-4 py-3 text-sm font-medium text-red-700">{unavailable.length} položek má nedostatečnou dostupnost v termínu</div>}
            <div className="space-y-3 p-4">
              {activeItems.length === 0 ? <p className="text-sm text-muted">Zatím žádné položky.</p> : [...activeGroups].map(([category, rows]) => (
                <section key={category} aria-label={category}>
                  <div className="flex justify-between gap-2 text-xs font-semibold tracking-wide text-muted uppercase">{category}<span>{rows.length}</span></div>
                  <ul className="divide-y divide-line border-b border-line">
                    {rows.map((row) => {
                      const name = row.item?.name ?? "Položka";
                      const current = Number(row.reservedQuantity);
                      const available = availability.get(row.inventoryItemId)?.available;
                      const value = qty[row.inventoryItemId] ?? current;
                      const savingItem = saving[row.inventoryItemId];
                      const save = () => applyReservation({ inventoryItemId: row.inventoryItemId, qty: value, item: row.item, createdById: row.createdById });
                      return <li key={row.inventoryItemId} className="py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">{row.item?.imageUrl ? <img className="size-full object-cover" loading="lazy" src={apiUrl(row.item.imageUrl)} alt="" /> : <Icons.Image className="size-4" />}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium wrap-break-word">{name}</div>
                            {available !== undefined && current > available && <div className="text-xs text-red-700">Chybí {current - Math.max(available, 0)} {row.item?.unit}</div>}
                          </div>
                          {canModifyReservation(row) ? <div className="flex items-center gap-1">
                            <Input type="number" aria-label={`Množství — ${name}`} min={0} max={available} className="h-8 w-16 px-1 text-center" value={value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => {
                              const number = Math.max(0, Number(event.target.value));
                              setQty((previous) => ({ ...previous, [row.inventoryItemId]: available === undefined ? number : Math.min(number, Math.max(0, available)) }));
                            }} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} disabled={savingItem} />
                            <button type="button" aria-label={`Uložit množství — ${name}`} title="Uložit množství" className="rounded-md p-1.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40" disabled={savingItem || value === current} onClick={() => void save()}><Check size={15} /></button>
                            <button type="button" title="Odebrat" aria-label={`Odebrat ${name}`} className="rounded-md p-1.5 text-muted hover:bg-red-100 hover:text-red-700" disabled={savingItem} onClick={() => void applyReservation({ inventoryItemId: row.inventoryItemId, qty: 0, item: row.item, createdById: row.createdById })}><Icons.Trash /></button>
                          </div> : <Badge>{current} {row.item?.unit ?? "ks"}</Badge>}
                        </div>
                      </li>;
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </aside>
        </div>
      </Modal>

    <QuickAddItemsModal
      open={quickAddOpen}
      onOpenChange={setQuickAddOpen}
      eventId={props.eventId}
      eventName={props.eventName}
      eventDate={props.eventDate}
      dayCount={props.dayCount}
      warehouseName={warehouses.find((warehouse) => warehouse.isHome)?.name}
      role={props.role}
      existingItems={currentItems}
      range={range}
      initialFavoritesOnly={favoritesOnly}
      onDone={props.onDone}
    />

    {crossSells && (
      <Modal
        open={!!crossSells}
        onOpenChange={(o) => {
          if (!o) setCrossSells(null);
        }}
        title="Související položky"
        description={<>K položce <strong>{crossSells.sourceItem?.name ?? "této položce"}</strong> doporučujeme přidat i následující:</>}
        contentClassName="max-w-2xl"
      >
        <div className="grid gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {crossSells.items.map((i: any) => {
            const itemId = i.itemId ?? i.id;
            const available = i.stock?.available ?? 0;
            const isAdded = currentItems.some(r => r.inventoryItemId === itemId && Number(r.reservedQuantity) > 0);
            
            return (
              <div key={itemId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white flex items-center justify-center border border-slate-100">
                    {i.imageUrl ? (
                      <img className="h-full w-full object-cover" src={apiUrl(i.imageUrl)} alt={i.name} />
                    ) : (
                      <Icons.Image className="h-4 w-4 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{i.name}</div>
                    <div className="text-xs text-slate-500">K dispozici: {available} {i.unit ?? "ks"}</div>
                  </div>
                </div>
                <div>
                  {isAdded ? (
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">Již přidáno</span>
                  ) : (
                    <Button 
                      size="sm" 
                      onClick={() => applyReservation({ inventoryItemId: itemId, qty: 1, item: i, createdById: userId })}
                      disabled={available === 0 || saving[itemId]}
                    >
                      Přidat 1 {i.unit ?? "ks"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setCrossSells(null)}>
            Zavřít
          </Button>
        </div>
      </Modal>
    )}

    </>
  );
}

/** Rozpad fyzickeho stavu po skladech. Domaci sklad se neznaci, ostatni ano -
 *  vydej mimo nej znamena dalsi cestu, at to manazer vidi uz pri vyberu. */
function WarehouseBreakdown(props: {
  stocks?: Record<string, number>;
  warehouses: Array<{ id: string; name: string; isHome?: boolean }>;
}) {
  const parts = props.warehouses
    .map((w) => ({ ...w, qty: props.stocks?.[w.id] ?? 0 }))
    .filter((w) => w.qty !== 0)
    .sort((a, b) => Number(b.isHome ?? false) - Number(a.isHome ?? false) || b.qty - a.qty);

  if (parts.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {parts.map((w) => (
        <span
          key={w.id}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            w.isHome ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"
          )}
          title={w.isHome ? "Domácí sklad" : "Mimo domácí sklad"}
        >
          {w.isHome ? "" : "! "}{w.name}: {w.qty}
        </span>
      ))}
    </div>
  );
}

function EditBasicsModal(props: { open: boolean; onOpenChange: (open: boolean) => void; event: any; notesOnly?: boolean; onDone: () => void }) {
  const [name, setName] = useState(props.event.name);
  const [location, setLocation] = useState(props.event.location);
  const [address, setAddress] = useState(props.event.address || "");
  const [registrationNumber, setRegistrationNumber] = useState(props.event.registrationNumber || "");
  const [notes, setNotes] = useState(props.event.notes || "");
  const [eventDate, setEventDate] = useState(toDateInputValue(props.event.eventDate));
  const [eventEndDate, setEventEndDate] = useState(toDateInputValue(props.event.eventEndDate));
  const [delivery, setDelivery] = useState(toDatetimeLocalValue(props.event.deliveryDatetime));
  const [pickup, setPickup] = useState(toDatetimeLocalValue(props.event.pickupDatetime));
  const [saving, setSaving] = useState(false);

  const saveNotes = async () => {
    setSaving(true);
    try {
      await api(`/events/${props.event.id}`, { method: "PATCH", body: JSON.stringify({ notes: notes.trim() || null }) });
      toast.success("Uloženo");
      props.onDone();
      props.onOpenChange(false);
    } catch (e: any) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  if (props.notesOnly) {
    return (
      <Modal open={props.open} onOpenChange={props.onOpenChange} title="Poznámka pro sklad" contentClassName="max-w-2xl">
        <label className="text-sm">
          Poznámka
          <Textarea className="mt-1" value={notes} onChange={(e: any) => setNotes(e.target.value)} />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>Zrušit</Button>
          <Button onClick={saveNotes} disabled={saving}>{saving ? "Ukládám..." : "Uložit poznámku"}</Button>
        </div>
      </Modal>
    );
  }

  const save = async () => {
    const deliveryIso = fromDatetimeLocalValue(delivery);
    const pickupIso = fromDatetimeLocalValue(pickup);
    if (!deliveryIso || !pickupIso) {
      toast.error("Vyplň závoz i svoz.");
      return;
    }
    setSaving(true);
    try {
      await api(`/events/${props.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          location,
          address: address || null,
          registration_number: registrationNumber.trim() || null,
          notes: notes.trim() || null,
          event_date: fromDateInputValue(eventDate),
          event_end_date: fromDateInputValue(eventEndDate),
          delivery_datetime: deliveryIso,
          pickup_datetime: pickupIso
        })
      });
      toast.success("Uloženo");
      props.onDone();
      props.onOpenChange(false);
    } catch (e: any) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Upravit údaje akce"
      contentClassName="max-w-2xl"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          Název
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm">
          Místo konání
          <Input className="mt-1" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="text-sm">
          Adresa
          <Input className="mt-1" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="text-sm">
          Evidenční číslo akce <span className="text-slate-400">(nepovinné)</span>
          <Input
            className="mt-1"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder="Např. 2026-0142"
          />
          <span className="mt-1 block text-xs text-slate-500">Číslo akce z nabídkové aplikace.</span>
        </label>
        <label className="text-sm md:col-span-2">
          Poznámka
          <Textarea className="mt-1" value={notes} onChange={(e: any) => setNotes(e.target.value)} />
        </label>
        <EventDateFields
          from={eventDate}
          to={eventEndDate}
          onChange={(from, to) => {
            setEventDate(from);
            setEventEndDate(to);
            const times = defaultDeliveryPickup(from, to, { delivery, pickup });
            if (times) {
              setDelivery(times.delivery);
              setPickup(times.pickup);
            }
          }}
        />
        <label className="text-sm">
          Závoz
          <Input className="mt-1" type="datetime-local" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </label>
        <label className="text-sm">
          Svoz
          <Input className="mt-1" type="datetime-local" value={pickup} onChange={(e) => setPickup(e.target.value)} />
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => props.onOpenChange(false)}>Zrušit</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Ukládám..." : "Uložit změny"}</Button>
      </div>
    </Modal>
  );
}

// Kopíruje se hlavně už proběhlá akce, takže její termíny bývají v minulosti.
// Posuneme je o celé dny dopředu tak, aby závoz vyšel na zítřek, a zachováme
// časy i rozestupy mezi datem akce, závozem a svozem.
function shiftDaysToTomorrow(delivery: Date): number {
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const days = Math.round((startOfDay(tomorrow).getTime() - startOfDay(delivery).getTime()) / 86400000);
  return days > 0 ? days : 0;
}

function DuplicateEventModal(props: { open: boolean; onOpenChange: (open: boolean) => void; event: any }) {
  const nav = useNavigate();
  const shift = shiftDaysToTomorrow(new Date(props.event.deliveryDatetime));

  const shiftLocal = (value: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    d.setDate(d.getDate() + shift);
    return toDatetimeLocalValue(d);
  };
  // event_date drží konvenci "UTC půlnoc", takže se posouvá v UTC.
  const shiftDate = (value: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    d.setUTCDate(d.getUTCDate() + shift);
    return toDateInputValue(d);
  };

  const [name, setName] = useState(`${props.event.name} (kopie)`);
  const [location, setLocation] = useState(props.event.location);
  const [address, setAddress] = useState(props.event.address || "");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [notes, setNotes] = useState(props.event.notes || "");
  const [eventDate, setEventDate] = useState(shiftDate(props.event.eventDate));
  const [eventEndDate, setEventEndDate] = useState(shiftDate(props.event.eventEndDate));
  const [delivery, setDelivery] = useState(shiftLocal(props.event.deliveryDatetime));
  const [pickup, setPickup] = useState(shiftLocal(props.event.pickupDatetime));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ eventId: string; dayCount: number; adjustments: any[] } | null>(null);

  const submit = async () => {
    const deliveryIso = fromDatetimeLocalValue(delivery);
    const pickupIso = fromDatetimeLocalValue(pickup);
    if (!deliveryIso || !pickupIso) {
      toast.error("Vyplň závoz i svoz.");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ event: { id: string }; adjustments: any[] }>(
        `/events/${props.event.id}/duplicate`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            location,
            address: address || null,
            registration_number: registrationNumber.trim() || null,
            notes: notes.trim() || null,
            event_date: fromDateInputValue(eventDate),
            event_end_date: fromDateInputValue(eventEndDate),
            delivery_datetime: deliveryIso,
            pickup_datetime: pickupIso
          })
        }
      );
      if (res.adjustments.length === 0) {
        toast.success("Akce zkopírována");
        props.onOpenChange(false);
        nav(`/events/${res.event.id}`);
        return;
      }
      setResult({ eventId: res.event.id, dayCount: eventDayCount(fromDateInputValue(eventDate), fromDateInputValue(eventEndDate)), adjustments: res.adjustments });
    } catch (e: any) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <Modal open={props.open} onOpenChange={props.onOpenChange} title="Akce zkopírována" contentClassName="max-w-2xl">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          V novém termínu nebyl dostatek zásob nebo se řádky nevešly do termínu akce. Zbytek doplň ručně, až se sklad uvolní.
        </div>
        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {result.adjustments.map((a) => (
            <div key={reservationRowKey(a)} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <span className="text-slate-800">
                {a.name}
                {result.dayCount > 1 && (a.dayFrom ?? 1) <= result.dayCount
                  ? ` (${dayRangeLabel({ dayFrom: a.dayFrom ?? 1, dayTo: a.dayTo ?? null }, result.dayCount)})`
                  : ""}
              </span>
              <span className={cn("font-medium", a.copiedQty === 0 ? "text-red-600" : "text-amber-700")}>
                {a.copiedQty === 0
                  ? (a.dayFrom ?? 1) > result.dayCount
                    ? "nevejde se do termínu nové akce"
                    : "nepřeneseno"
                  : `${a.sourceQty} → ${a.copiedQty} ${a.unit}`}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={() => {
              props.onOpenChange(false);
              nav(`/events/${result.eventId}`);
            }}
          >
            Otevřít kopii
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={props.open} onOpenChange={props.onOpenChange} title="Kopírovat akci" contentClassName="max-w-2xl">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Vznikne nová akce ve stavu Rozpracováno se stejnými položkami. Množství, na které v novém termínu nezbývají
        zásoby, se zkrátí a vypíšeme ho.
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          Název
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm">
          Místo konání
          <Input className="mt-1" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="text-sm">
          Adresa
          <Input className="mt-1" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="text-sm">
          Evidenční číslo akce <span className="text-slate-400">(nepovinné)</span>
          <Input
            className="mt-1"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder="Např. 2026-0142"
          />
          <span className="mt-1 block text-xs text-slate-500">Kopie ho nepřebírá, nová akce má vlastní číslo.</span>
        </label>
        <label className="text-sm md:col-span-2">
          Poznámka
          <Textarea className="mt-1" value={notes} onChange={(e: any) => setNotes(e.target.value)} />
        </label>
        <EventDateFields
          from={eventDate}
          to={eventEndDate}
          onChange={(from, to) => {
            setEventDate(from);
            setEventEndDate(to);
            const times = defaultDeliveryPickup(from, to, { delivery, pickup });
            if (times) {
              setDelivery(times.delivery);
              setPickup(times.pickup);
            }
          }}
        />
        <label className="text-sm">
          Závoz
          <Input className="mt-1" type="datetime-local" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </label>
        <label className="text-sm">
          Svoz
          <Input className="mt-1" type="datetime-local" value={pickup} onChange={(e) => setPickup(e.target.value)} />
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => props.onOpenChange(false)}>Zrušit</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Kopíruji..." : "Vytvořit kopii"}</Button>
      </div>
    </Modal>
  );
}
