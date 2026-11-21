import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { httpError } from "../lib/httpErrors.js";
import { requireRole } from "../lib/rbac.js";

const ItemParams = z.object({ id: z.uuid() });
const favoritesPath = "/inventory/favorites";

export async function favoriteRoutes(app: FastifyInstance) {
  const writeOptions = {
    preHandler: [
      app.authenticate,
      app.rateLimit({
        max: 120,
        timeWindow: "1 minute",
        keyGenerator: (request) => `inventory-favorites:${request.user.id}`
      })
    ]
  };

  app.get(favoritesPath, { preHandler: [app.authenticate] }, async (request, reply) => {
    requireRole(request.user.role, ["event_manager"]);
    const favorites = await app.prisma.inventoryFavorite.findMany({
      where: { userId: request.user.id },
      select: { inventoryItemId: true }
    });
    return reply.header("Cache-Control", "private, no-store").send({ itemIds: favorites.map((row) => row.inventoryItemId) });
  });

  app.put(`${favoritesPath}/:id`, writeOptions, async (request, reply) => {
    requireRole(request.user.role, ["event_manager"]);
    const { id: inventoryItemId } = ItemParams.parse(request.params);
    const item = await app.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId, active: true },
      select: { id: true }
    });
    if (!item) return httpError(reply, 404, "ITEM_NOT_FOUND", "Položka už není v katalogu.");

    try {
      await app.prisma.inventoryFavorite.createMany({
        data: { userId: request.user.id, inventoryItemId },
        skipDuplicates: true
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return httpError(reply, 404, "ITEM_NOT_FOUND", "Položka už není v katalogu.");
      }
      throw error;
    }
    return { ok: true };
  });

  app.delete(`${favoritesPath}/:id`, writeOptions, async (request) => {
    requireRole(request.user.role, ["event_manager"]);
    const { id: inventoryItemId } = ItemParams.parse(request.params);
    await app.prisma.inventoryFavorite.deleteMany({
      where: { userId: request.user.id, inventoryItemId }
    });
    return { ok: true };
  });
}
