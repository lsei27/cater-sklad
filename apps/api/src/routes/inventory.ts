import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { ReservationState } from "../../generated/prisma/client.js";
import { httpError } from "../lib/httpErrors.js";
import { getPhysicalTotal } from "../services/availability.js";

export async function inventoryRoutes(app: FastifyInstance) {
  app.get("/categories/tree", { preHandler: [app.authenticate] }, async () => {
    const parents = await app.prisma.category.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { children: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } }
    });
    return { parents };
  });

  app.get("/inventory/items", { preHandler: [app.authenticate] }, async (request) => {
    const query = z
      .object({
        search: z.string().optional(),
        parent_category_id: z.string().uuid().optional(),
        category_id: z.string().uuid().optional(),
        active: z.coerce.boolean().optional(),
        with_stock: z.coerce.boolean().optional(),
        start_at: z.string().datetime().optional(),
        end_at: z.string().datetime().optional()
      })
      .parse(request.query);

    const where: Prisma.InventoryItemWhereInput = {};
    if (query.active !== undefined) where.active = query.active;
    if (query.category_id) where.categoryId = query.category_id;
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };
    const items = await app.prisma.inventoryItem.findMany({
      where,
      orderBy: { name: "asc" },
      include: { category: { include: { parent: true } }, warehouse: true }
    });

    const filtered =
      query.parent_category_id
        ? items.filter((i) => i.category.parentId === query.parent_category_id)
        : items;

    if (!query.with_stock) return { items: filtered };

    const startAt = query.start_at ? new Date(query.start_at) : new Date();
    const endAt = query.end_at ? new Date(query.end_at) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const itemIds = filtered.map((i) => i.id);

    const stockRows = await app.prisma.$transaction(async (tx) => {
      if (itemIds.length === 0) return [] as Array<{ inventory_item_id: string; physical_total: number; blocked_total: number; available: number }>;
      return tx.$queryRaw<
        Array<{ inventory_item_id: string; physical_total: number; blocked_total: number; available: number }>
      >`
WITH params AS (
  SELECT ${startAt}::timestamptz AS t_start, ${endAt}::timestamptz AS t_end
),
items AS (
  SELECT id, return_delay_days
  FROM inventory_items
  WHERE id = ANY(${itemIds}::uuid[])
),
physical AS (
  SELECT inventory_item_id, COALESCE(SUM(delta_quantity),0)::int AS physical_total
  FROM inventory_ledger
  WHERE inventory_item_id = ANY(${itemIds}::uuid[])
  GROUP BY inventory_item_id
),
blocked AS (
  SELECT
    r.inventory_item_id,
    COALESCE(SUM(r.reserved_quantity),0)::int AS blocked_total
  FROM event_reservations r
  JOIN events e2 ON e2.id = r.event_id
  JOIN items i ON i.id = r.inventory_item_id
	  CROSS JOIN params p
	  WHERE r.inventory_item_id = ANY(${itemIds}::uuid[])
	    AND e2.status NOT IN ('CLOSED','CANCELLED')
	    AND (
	      r.state = 'confirmed'
	      OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW())
	    )
    AND (
      e2.delivery_datetime < (p.t_end + (i.return_delay_days || ' days')::interval)
      AND p.t_start < (e2.pickup_datetime + (i.return_delay_days || ' days')::interval)
    )
  GROUP BY r.inventory_item_id
)
SELECT
  i.id::text AS inventory_item_id,
  COALESCE(p.physical_total,0)::int AS physical_total,
  COALESCE(b.blocked_total,0)::int AS blocked_total,
  (COALESCE(p.physical_total,0) - COALESCE(b.blocked_total,0))::int AS available
FROM items i
LEFT JOIN physical p ON p.inventory_item_id = i.id
LEFT JOIN blocked b ON b.inventory_item_id = i.id;
      `;
    });

    const stockById = new Map(stockRows.map((r) => [r.inventory_item_id, r]));
    const dto = filtered.map((it) => {
      const s = stockById.get(it.id) ?? { physical_total: 0, blocked_total: 0, available: 0 };
      return {
        itemId: it.id,
        name: it.name,
        sku: it.sku,
        unit: it.unit,
        imageUrl: it.imageUrl,
        masterPackageQty: it.masterPackageQty,
        masterPackageWeight: it.masterPackageWeight,
        volume: it.volume,
        plateDiameter: it.plateDiameter,
        warehouse: it.warehouse ? { id: it.warehouse.id, name: it.warehouse.name } : null,
        category: {
          parent: it.category.parent ? { id: it.category.parent.id, name: it.category.parent.name, sortOrder: it.category.parent.sortOrder } : null,
          sub: { id: it.category.id, name: it.category.name, sortOrder: it.category.sortOrder }
        },
        stock: {
          total: Number(s.physical_total),
          reserved: Number(s.blocked_total),
          available: Number(s.available)
        }
      };
    });

    return { items: dto, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
  });

  app.get("/inventory/items/:id/cross-sells", { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        start_at: z.string().datetime().optional(),
        end_at: z.string().datetime().optional()
      })
      .parse(request.query);

    // Get target item IDs from crossSellLinks where source = :id
    const links = await app.prisma.crossSellLink.findMany({
      where: { sourceItemId: params.id },
      select: { targetItemId: true }
    });
    if (links.length === 0) return { items: [] };

    const targetItemIds = links.map((l) => l.targetItemId);

    const targetItems = await app.prisma.inventoryItem.findMany({
      where: { id: { in: targetItemIds }, active: true },
      include: { category: { include: { parent: true } }, warehouse: true }
    });

    if (targetItems.length === 0) return { items: [] };

    const startAt = query.start_at ? new Date(query.start_at) : new Date();
    const endAt = query.end_at ? new Date(query.end_at) : new Date(Date.now() + 7 * 24 * 3600 * 1000);

    const stockRows = await app.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<
        Array<{ inventory_item_id: string; physical_total: number; blocked_total: number; available: number }>
      >`
WITH params AS (
  SELECT ${startAt}::timestamptz AS t_start, ${endAt}::timestamptz AS t_end
),
items AS (
  SELECT id, return_delay_days
  FROM inventory_items
  WHERE id = ANY(${targetItemIds}::uuid[])
),
physical AS (
  SELECT inventory_item_id, COALESCE(SUM(delta_quantity),0)::int AS physical_total
  FROM inventory_ledger
  WHERE inventory_item_id = ANY(${targetItemIds}::uuid[])
  GROUP BY inventory_item_id
),
blocked AS (
  SELECT
    r.inventory_item_id,
    COALESCE(SUM(r.reserved_quantity),0)::int AS blocked_total
  FROM event_reservations r
  JOIN events e2 ON e2.id = r.event_id
  JOIN items i ON i.id = r.inventory_item_id
  CROSS JOIN params p
  WHERE r.inventory_item_id = ANY(${targetItemIds}::uuid[])
    AND e2.status NOT IN ('CLOSED','CANCELLED')
    AND (
      r.state = 'confirmed'
      OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW())
    )
    AND (
      e2.delivery_datetime < (p.t_end + (i.return_delay_days || ' days')::interval)
      AND p.t_start < (e2.pickup_datetime + (i.return_delay_days || ' days')::interval)
    )
  GROUP BY r.inventory_item_id
)
SELECT
  i.id::text AS inventory_item_id,
  COALESCE(p.physical_total,0)::int AS physical_total,
  COALESCE(b.blocked_total,0)::int AS blocked_total,
  (COALESCE(p.physical_total,0) - COALESCE(b.blocked_total,0))::int AS available
FROM items i
LEFT JOIN physical p ON p.inventory_item_id = i.id
LEFT JOIN blocked b ON b.inventory_item_id = i.id;
      `;
    });

    const stockById = new Map(stockRows.map((r) => [r.inventory_item_id, r]));
    const dto = targetItems.map((it) => {
      const s = stockById.get(it.id) ?? { physical_total: 0, blocked_total: 0, available: 0 };
      return {
        itemId: it.id,
        name: it.name,
        sku: it.sku,
        unit: it.unit,
        imageUrl: it.imageUrl,
        masterPackageQty: it.masterPackageQty,
        category: {
          parent: it.category.parent ? { id: it.category.parent.id, name: it.category.parent.name, sortOrder: it.category.parent.sortOrder } : null,
          sub: { id: it.category.id, name: it.category.name, sortOrder: it.category.sortOrder }
        },
        stock: {
          total: Number(s.physical_total),
          reserved: Number(s.blocked_total),
          available: Number(s.available)
        }
      };
    });

    return { items: dto };
  });

  app.get("/warehouses", { preHandler: [app.authenticate] }, async (request) => {
    const q = z.object({ all: z.string().optional() }).parse(request.query);
    const warehouses = await app.prisma.warehouse.findMany({
      where: q.all === "true" ? {} : { active: true },
      orderBy: { name: "asc" }
    });
    return { warehouses };
  });

  app.get("/inventory/warehouse-stocks", { preHandler: [app.authenticate] }, async (request) => {
    const stocks = await app.prisma.inventoryLedger.groupBy({
      by: ["inventoryItemId", "warehouseId"],
      _sum: { deltaQuantity: true },
      where: { warehouseId: { not: null } }
    });

    // Map to a more useful format: { [itemId]: { [warehouseId]: quantity } }
    const result: Record<string, Record<string, number>> = {};
    for (const s of stocks) {
      if (!s.warehouseId) continue;
      if (!result[s.inventoryItemId]) result[s.inventoryItemId] = {};
      result[s.inventoryItemId][s.warehouseId] = s._sum.deltaQuantity ?? 0;
    }

    return { stocks: result };
  });

  app.post("/inventory/transfers", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z.object({
      inventory_item_id: z.string().uuid(),
      from_warehouse_id: z.string().uuid(),
      to_warehouse_id: z.string().uuid(),
      quantity: z.number().int().positive(),
      note: z.string().optional()
    }).parse(request.body);

    if (body.from_warehouse_id === body.to_warehouse_id) {
      return httpError(reply, 400, "BAD_REQUEST", "Zdrojový a cílový sklad musí být odlišné");
    }

    const res = await app.prisma.$transaction(async (tx) => {
      // Create transfer record
      const transfer = await tx.warehouseTransfer.create({
        data: {
          inventoryItemId: body.inventory_item_id,
          fromWarehouseId: body.from_warehouse_id,
          toWarehouseId: body.to_warehouse_id,
          quantity: body.quantity,
          note: body.note,
          transferredById: request.user!.id
        }
      });

      // Create ledger entries
      await tx.inventoryLedger.createMany({
        data: [
          {
            inventoryItemId: body.inventory_item_id,
            deltaQuantity: -body.quantity,
            reason: "transfer",
            warehouseId: body.from_warehouse_id,
            note: body.note || `Převod do ${body.to_warehouse_id}`,
            createdById: request.user!.id
          },
          {
            inventoryItemId: body.inventory_item_id,
            deltaQuantity: body.quantity,
            reason: "transfer",
            warehouseId: body.to_warehouse_id,
            note: body.note || `Převod z ${body.from_warehouse_id}`,
            createdById: request.user!.id
          }
        ]
      });

      return transfer;
    });

    return { transfer: res };
  });
}
