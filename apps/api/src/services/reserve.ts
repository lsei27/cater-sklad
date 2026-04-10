import type { Role, Prisma } from "../../generated/prisma/client.js";
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
  if (event.status === "ISSUED" || event.status === "CLOSED" || event.status === "CANCELLED") {
    throw new Error("EVENT_READ_ONLY");
  }

  // 1. Check Role Category Access
  if (actor.role !== "admin") {
    const allowedAccess = await (tx as any).roleCategoryAccess.findMany({
      where: { role: actor.role },
      select: { categoryId: true }
    });

    // Empty role config means unrestricted access for that role.
    // Restrictions only apply once admin explicitly assigns categories.
    if (allowedAccess.length > 0) {
    const allowedCategoryIds = new Set(allowedAccess.map((a: any) => a.categoryId));

      const itemIds = items.map((i) => i.inventoryItemId);
      const itemCats = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, categoryId: true, category: { select: { parentId: true } } }
      });

      for (const item of itemCats) {
        const isAllowed =
          allowedCategoryIds.has(item.categoryId) ||
          (item.category.parentId && allowedCategoryIds.has(item.category.parentId));

        if (!isAllowed) {
          throw new Error("CATEGORY_ACCESS_DENIED");
        }
      }
    }
  }

  // 2. Master Package roundup — adjust quantities to full master packages
  const itemIdsForLookup = items.filter((i) => i.qty > 0).map((i) => i.inventoryItemId);
  const masterPackageItems = itemIdsForLookup.length > 0
    ? await tx.inventoryItem.findMany({
        where: { id: { in: itemIdsForLookup }, masterPackageQty: { not: null } },
        select: { id: true, masterPackageQty: true }
      })
    : [];
  const masterPackageMap = new Map(masterPackageItems.map((i) => [i.id, i.masterPackageQty!]));

  const adjustedItems = items.map((item) => {
    if (item.qty <= 0) return { ...item, originalQty: item.qty };
    const mpq = masterPackageMap.get(item.inventoryItemId);
    if (mpq && mpq > 0) {
      const roundedQty = Math.ceil(item.qty / mpq) * mpq;
      return { ...item, originalQty: item.qty, qty: roundedQty };
    }
    return { ...item, originalQty: item.qty };
  });

  for (const { inventoryItemId } of adjustedItems) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2025, hashtext(${inventoryItemId}))`;
  }

  // Fetch existing reservations to check ownership
  const existingReservations = await tx.eventReservation.findMany({
    where: { eventId, inventoryItemId: { in: adjustedItems.map((i) => i.inventoryItemId) } },
    select: { inventoryItemId: true, createdById: true }
  });
  const existingMap = new Map(existingReservations.map((r) => [r.inventoryItemId, r]));

  for (const { inventoryItemId, qty } of adjustedItems) {
    const a = await getAvailabilityForEventItemTx(tx, eventId, inventoryItemId);
    if (qty > a.available) throw new InsufficientStockError(inventoryItemId, a.available);
  }

  const now = new Date();
  const expiresAt =
    event.status === "DRAFT" ? new Date(now.getTime() + 30 * 60 * 1000) : null;
  const state = event.status === "DRAFT" ? "draft" : "confirmed";

  for (const { inventoryItemId, qty } of adjustedItems) {
    const existing = existingMap.get(inventoryItemId);
    const createdById = existing?.createdById ?? actor.id;

    if (qty <= 0) {
      if (existing) {
        await tx.eventReservation.delete({
          where: { eventId_inventoryItemId: { eventId, inventoryItemId } }
        });
      }
    } else {
      await tx.eventReservation.upsert({
        where: { eventId_inventoryItemId: { eventId, inventoryItemId } },
        update: { reservedQuantity: qty, state, expiresAt, createdById },
        create: { eventId, inventoryItemId, reservedQuantity: qty, state, expiresAt, createdById: actor.id }
      });
    }
  }

  if (event.status === "SENT_TO_WAREHOUSE") {
    await tx.event.update({ where: { id: eventId }, data: { exportNeedsRevision: true } });
  }

  // Return adjusted items info so the caller can inform the user about roundups
  const masterPackageAdjustments = adjustedItems
    .filter((i) => i.originalQty !== i.qty && i.qty > 0)
    .map((i) => ({
      inventoryItemId: i.inventoryItemId,
      requestedQty: i.originalQty,
      adjustedQty: i.qty,
      masterPackageQty: masterPackageMap.get(i.inventoryItemId) ?? null
    }));

  return { state, expiresAt, masterPackageAdjustments };
}
