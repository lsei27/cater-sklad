import type { Role, Prisma } from "@prisma/client";
import { getAvailabilityForEventItemTx } from "./availability.js";

export class InsufficientStockError extends Error {
  constructor(
    public inventoryItemId: string,
    public available: number
  ) {
    super("INSUFFICIENT_STOCK");
  }
}

export async function reserveItemsTx(params: {
  tx: Prisma.TransactionClient;
  actor: { id: string; role: Role };
  eventId: string;
  items: Array<{ inventoryItemId: string; qty: number }>;
}) {
  const { tx, actor, eventId, items } = params;

  const [event] = await tx.$queryRaw<{ id: string; status: string; export_needs_revision: boolean }[]>`
    SELECT id, status::text, export_needs_revision
    FROM events
    WHERE id = ${eventId}::uuid
    FOR UPDATE
  `;
  if (!event) throw new Error("EVENT_NOT_FOUND");
  if (event.status === "ISSUED" || event.status === "CLOSED") throw new Error("EVENT_READ_ONLY");

  if (actor.role === "chef") {
    const ids = items.map((i) => i.inventoryItemId);
    const rows = await tx.$queryRaw<{ id: string; parent_name: string }[]>`
      SELECT i.id::text, p.name AS parent_name
      FROM inventory_items i
      JOIN categories c ON c.id = i.category_id
      JOIN categories p ON p.id = c.parent_id
      WHERE i.id = ANY(${ids}::uuid[])
    `;
    if (rows.length !== ids.length) throw new Error("CHEF_ONLY_TECH");
    const nonTech = rows.find((r) => (r.parent_name ?? "").toLowerCase() !== "technika");
    if (nonTech) throw new Error("CHEF_ONLY_TECH");
  }

  for (const { inventoryItemId } of items) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2025, hashtext(${inventoryItemId}))`;
  }

  for (const { inventoryItemId, qty } of items) {
    const a = await getAvailabilityForEventItemTx(tx, eventId, inventoryItemId);
    if (qty > a.available) throw new InsufficientStockError(inventoryItemId, a.available);
  }

  const now = new Date();
  const expiresAt =
    event.status === "DRAFT" ? new Date(now.getTime() + 30 * 60 * 1000) : null;
  const state = event.status === "DRAFT" ? "draft" : "confirmed";

  for (const { inventoryItemId, qty } of items) {
    await tx.eventReservation.upsert({
      where: { eventId_inventoryItemId: { eventId, inventoryItemId } },
      update: { reservedQuantity: qty, state, expiresAt },
      create: { eventId, inventoryItemId, reservedQuantity: qty, state, expiresAt }
    });
  }

  if (event.status === "SENT_TO_WAREHOUSE") {
    await tx.event.update({ where: { id: eventId }, data: { exportNeedsRevision: true } });
  }

  return { state, expiresAt };
}
