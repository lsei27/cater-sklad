import type { FastifyInstance } from "fastify";
import { z } from "zod";

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
        active: z.coerce.boolean().optional()
      })
      .parse(request.query);

    const where: any = {};
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

    return { items: filtered };
  });
}

