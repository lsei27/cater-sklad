import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { ReservationState } from "../../generated/prisma/client.js";

export async function inventoryRoutes(app: FastifyInstance) {
  app.get("/categories/tree", { preHandler: [app.authenticate] }, async () => {
    const parents = await app.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { name: "asc" },
      include: { children: { orderBy: { name: "asc" } } }
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
      include: { category: { include: { parent: true } } }
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
        unit: it.unit,
        imageUrl: it.imageUrl,
        category: {
          parent: it.category.parent ? { id: it.category.parent.id, name: it.category.parent.name } : null,
          sub: { id: it.category.id, name: it.category.name }
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
}
