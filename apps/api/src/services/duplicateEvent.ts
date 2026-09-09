import type { Prisma, Role } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemsTx } from "./availability.js";
import { reserveItemsTx } from "./reserve.js";

/// Položka, která se do kopie nevešla celá. copiedQty === 0 znamená, že
/// se nepřenesla vůbec.
export type DuplicateAdjustment = {
  inventoryItemId: string;
  name: string;
  unit: string;
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
    deliveryDatetime: Date;
    pickupDatetime: Date;
  };
}) {
  const { tx, actor, sourceEventId, data } = params;

  const source = await tx.event.findUnique({ where: { id: sourceEventId }, select: { id: true } });
  if (!source) throw new Error("EVENT_NOT_FOUND");

  const reservations = await tx.eventReservation.findMany({
    where: { eventId: sourceEventId, reservedQuantity: { gt: 0 } },
    select: {
      inventoryItemId: true,
      reservedQuantity: true,
      item: { select: { name: true, unit: true, masterPackageQty: true } }
    }
  });

  const event = await tx.event.create({
    data: { ...data, status: "DRAFT", createdById: actor.id }
  });

  if (reservations.length === 0) return { event, adjustments: [] as DuplicateAdjustment[] };

  // Dostupnost se počítá podle termínu nové akce, takže se do kopie nemusí vejít
  // všechno. Množství krátíme dolů na celá master balení - reserveItemsTx by je
  // jinak zaokrouhlil nahoru a spadl na nedostatku zásob.
  const availability = await getAvailabilityForEventItemsTx(
    tx,
    event.id,
    reservations.map((r) => r.inventoryItemId)
  );
  const availableByItemId = new Map(availability.map((a) => [a.inventoryItemId, a.available]));

  const adjustments: DuplicateAdjustment[] = [];
  const items: Array<{ inventoryItemId: string; qty: number }> = [];

  for (const r of reservations) {
    const available = Math.max(availableByItemId.get(r.inventoryItemId) ?? 0, 0);
    let qty = Math.min(r.reservedQuantity, available);
    const mpq = r.item.masterPackageQty;
    if (mpq && mpq > 0) qty = Math.floor(qty / mpq) * mpq;

    if (qty !== r.reservedQuantity) {
      adjustments.push({
        inventoryItemId: r.inventoryItemId,
        name: r.item.name,
        unit: r.item.unit,
        sourceQty: r.reservedQuantity,
        copiedQty: qty
      });
    }
    if (qty > 0) items.push({ inventoryItemId: r.inventoryItemId, qty });
  }

  if (items.length > 0) {
    await reserveItemsTx({ tx, actor, eventId: event.id, items });
  }

  return { event, adjustments };
}
