import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiBaseUrl, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import toast from "react-hot-toast";
import { statusLabel } from "../lib/viewModel";

type Snapshot = {
  event: { version: number };
  groups: Array<{ items: Array<{ inventoryItemId: string; name: string; unit: string; qty: number }> }>;
};

type WarehouseItem = { inventoryItemId: string; name: string; unit: string; qty: number };

export default function WarehouseEventDetailPage() {
  const role = getCurrentUser()?.role ?? "";
  const { id } = useParams();
  const nav = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [rows, setRows] = useState<Array<{ inventory_item_id: string; name: string; unit: string; requested: number; returned: number; broken: number; total?: number }>>([]);

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

  useEffect(() => {
    load();
  }, [id]);

  const snapshot: Snapshot | null = useMemo(() => {
    const ex = (event?.exports?.[0] ?? null);
    return ex?.snapshotJson ?? null;
  }, [event]);

  const snapshotItems = useMemo(() => {
    const list = snapshot?.groups?.flatMap((g) => g.items) ?? [];
    return list;
  }, [snapshot]);

  const warehouseItems: WarehouseItem[] = useMemo(() => {
    const fromEvent = (event?.warehouseItems ?? []) as WarehouseItem[];
    if (fromEvent.length > 0) return fromEvent;
    return snapshotItems as WarehouseItem[];
  }, [event?.warehouseItems, snapshotItems]);

  useEffect(() => {
    if (!warehouseItems.length) return;

    // Aggregation of historical returns/issues from server
    const serverReturns = new Map<string, { returned: number, broken: number }>();
    if (event?.returns) {
      for (const r of event.returns) {
        const current = serverReturns.get(r.inventoryItemId) || { returned: 0, broken: 0 };
        current.returned += r.returnedQuantity || 0;
        current.broken += r.brokenQuantity || 0;
        serverReturns.set(r.inventoryItemId, current);
      }
    }
    if (event?.issues) {
      // Missing items are recorded as issues with type "missing". 
      // The warehouse UI check badge "Chybí" logic: Math.max(0, r.requested - r.returned - r.broken)
      // So we don't need to add issues to "broken" unless they are specifically of type "broken".
      // But actually, in the report we aggregated brokenQty from issues too.
      // Let's stick to reconciliation of returned/broken from the actual return records first.
    }

    setRows(
      warehouseItems.map((i) => {
        const s = serverReturns.get(i.inventoryItemId);
        return {
          inventory_item_id: i.inventoryItemId,
          name: i.name,
          unit: i.unit,
          requested: i.qty,
          returned: s?.returned ?? 0,
          broken: s?.broken ?? 0
        };
      })
    );
  }, [warehouseItems, event?.returns]);

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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{event.name}</div>
              <div className="text-sm text-slate-600">{event.location}</div>
              <div className="mt-2 text-xs text-slate-500">
                {new Date(event.deliveryDatetime).toLocaleString()} → {new Date(event.pickupDatetime).toLocaleString()}
              </div>
              {snapshot?.event?.version ? (
                <div className="mt-2 text-xs text-slate-500">Export verze: v{snapshot.event.version}</div>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <Badge tone={event.status === "ISSUED" ? "warn" : event.status === "SENT_TO_WAREHOUSE" ? "ok" : "neutral"}>
                {statusLabel(event.status)}
              </Badge>
              {event.chefConfirmedAt ? (
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-medium text-green-700">
                  <span>✓ Kuchyň potvrzena</span>
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-medium text-amber-700">
                  <span>⏲ Čeká na kuchyň</span>
                </div>
              )}
            </div>
          </div>
          {event.status === "CLOSED" ? (
            <div className="mt-4 border-t pt-4">
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

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Akce</div>
          <div className="mt-1 text-sm text-slate-600">Dvě hlavní operace pro sklad.</div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2">
            <Button full disabled={issueDisabled} onClick={() => setConfirmIssue(true)}>
              Potvrdit vydání
            </Button>
            <Button full variant="danger" disabled={closeDisabled} onClick={() => setConfirmClose(true)}>
              Uzavřít akci
            </Button>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            Uzavření provede odepsání rozbitého a chybějícího množství.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Položky</div>
          <div className="mt-1 text-sm text-slate-600">Požadované množství je z posledního exportu.</div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-slate-600">Pro tuto akci nejsou žádné položky.</div>
          ) : (
            <div className="space-y-3">
              {rows.map((r, idx) => {
                const missing = Math.max(0, r.requested - r.returned - r.broken);
                return (
                  <div key={r.inventory_item_id} className="rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.name}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          Požadováno: <span className="font-semibold text-slate-900">{r.requested}</span> {r.unit}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Celkem skladem: <span className="font-semibold text-slate-900">{r.total ?? "—"}</span> {r.unit}
                        </div>
                      </div>
                      <Badge tone={missing > 0 ? "warn" : "ok"}>Chybí: {missing}</Badge>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs">
                        Vráceno
                        <Input
                          className="mt-1"
                          type="number"
                          min={0}
                          value={r.returned}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value));
                            setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, returned: v } : x)));
                          }}
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
                            const v = Math.max(0, Number(e.target.value));
                            setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, broken: v } : x)));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={setConfirmIssue}
        title="Potvrdit vydání?"
        description="Výdej uzamkne akci pro běžné úpravy."
        confirmText="Potvrdit výdej"
        onConfirm={async () => {
          if (!id) return;
          try {
            await api(`/events/${id}/issue`, { method: "POST", body: JSON.stringify({ idempotency_key: `issue:${Date.now()}` }) });
            toast.success("Vydání potvrzeno");
            await load();
          } catch (e: any) {
            toast.error(e?.error?.message ?? "Nepodařilo se potvrdit výdej.");
          }
        }}
      />

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        tone="danger"
        title="Uzavřít akci?"
        description="Prověříme vrácené/rozbité kusy a dopočítáme chybějící. Chybějící a rozbité se odečte ze stavu skladu."
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
                  returned_quantity: r.returned,
                  broken_quantity: r.broken
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
    </div>
  );
}
