import type { Prisma, Role } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemsTx } from "./availability.js";
import { reserveItemsTx } from "./reserve.js";
import { dayRangeKey, eventDayCount, type DayRange } from "../lib/eventDays.js";

/// Řádek, který se do kopie nevešel celý. copiedQty === 0 znamená, že
/// se nepřenesl vůbec.
export type DuplicateAdjustment = {
  inventoryItemId: string;
  name: string;
  unit: string;
  dayFrom: number;
  dayTo: number | null;
  sourceQty: number;
  copiedQty: number;
};

export async function duplicateEventTx(params: {
  tx: Prisma.TransactionClient;
  actor: { id: string; role: Role };
  sourceEventId: string;
  data: {
    name: string;
    location: string;
    address: string | null;
    notes: string | null;
    registrationNumber: string | null;
    eventDate: Date | null;
    eventEndDate: Date | null;
    deliveryDatetime: Date;
    pickupDatetime: Date;
  };
}) {
  const { tx, actor, sourceEventId, data } = params;

  const source = await tx.event.findUnique({ where: { id: sourceEventId }, select: { id: true } });
  if (!source) throw new Error("EVENT_NOT_FOUND");

  const reservations = await tx.eventReservation.findMany({
    where: { eventId: sourceEventId, reservedQuantity: { gt: 0 } },
    orderBy: [{ inventoryItemId: "asc" }, { dayFrom: "asc" }],
    select: {
      inventoryItemId: true,
      reservedQuantity: true,
      dayFrom: true,
      dayTo: true,
      item: { select: { name: true, unit: true, masterPackageQty: true } }
    }
  });

  const event = await tx.event.create({
    data: { ...data, status: "DRAFT", createdById: actor.id }
  });

  if (reservations.length === 0) return { event, adjustments: [] as DuplicateAdjustment[] };

  const adjustments: DuplicateAdjustment[] = [];

  // Řádky se přizpůsobí délce nové akce. Co začíná až po jejím posledním dni,
  // se nepřenese. Konec za posledním dnem se zkrátí na „do konce akce“ a řádky,
  // které tím dostanou stejný rozsah, se sečtou.
  const dayCount = eventDayCount(data.eventDate, data.eventEndDate);
  const merged = new Map<string, { inventoryItemId: string; range: DayRange; qty: number; item: (typeof reservations)[number]["item"] }>();
  for (const r of reservations) {
    if (r.dayFrom > dayCount) {
      adjustments.push({
        inventoryItemId: r.inventoryItemId,
        name: r.item.name,
        unit: r.item.unit,
        dayFrom: r.dayFrom,
        dayTo: r.dayTo,
        sourceQty: r.reservedQuantity,
        copiedQty: 0
      });
      continue;
    }
    const range: DayRange = { dayFrom: r.dayFrom, dayTo: r.dayTo !== null && r.dayTo < dayCount ? r.dayTo : null };
    const key = `${r.inventoryItemId}|${dayRangeKey(range)}`;
    const prev = merged.get(key);
    merged.set(key, { inventoryItemId: r.inventoryItemId, range, qty: (prev?.qty ?? 0) + r.reservedQuantity, item: r.item });
  }

  // Dostupnost se počítá podle termínu nové akce, takže se do kopie nemusí vejít
  // všechno. Množství krátíme dolů na celá master balení - reserveItemsTx by je
  // jinak zaokrouhlil nahoru a spadl na nedostatku zásob. Řádky se rezervují
  // postupně, aby další řádek téže položky viděl ty předchozí.
  for (const m of merged.values()) {
    const [availability] = await getAvailabilityForEventItemsTx(tx, event.id, [m.inventoryItemId], { range: m.range });
    let qty = Math.min(m.qty, Math.max(availability?.available ?? 0, 0));
    const mpq = m.item.masterPackageQty;
    if (mpq && mpq > 0) qty = Math.floor(qty / mpq) * mpq;

    if (qty !== m.qty) {
      adjustments.push({
        inventoryItemId: m.inventoryItemId,
        name: m.item.name,
        unit: m.item.unit,
        dayFrom: m.range.dayFrom,
        dayTo: m.range.dayTo,
        sourceQty: m.qty,
        copiedQty: qty
      });
    }
    if (qty > 0) {
      await reserveItemsTx({
        tx,
        actor,
        eventId: event.id,
        items: [{ inventoryItemId: m.inventoryItemId, qty, dayFrom: m.range.dayFrom, dayTo: m.range.dayTo }]
      });
    }
  }

  return { event, adjustments };
}
