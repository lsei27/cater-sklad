import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import { favoriteRoutes } from "../src/routes/favorites.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";

describe("inventory favorites (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";

  it.runIf(run)("keeps favorites private to each account and makes repeated writes safe", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const app = Fastify();
    app.decorate("prisma", prisma);
    await app.register(rateLimit, { global: false });
    await app.register(authPlugin, { jwtSecret: crypto.randomUUID() });
    await app.register(favoriteRoutes);

    try {
      const stamp = fixtureStamp();
      const [first, second, chef, admin, warehouse] = await Promise.all([
        prisma.user.create({ data: { email: `favorites-first-${stamp}@local`, passwordHash: "x", role: "event_manager" } }),
        prisma.user.create({ data: { email: `favorites-second-${stamp}@local`, passwordHash: "x", role: "event_manager" } }),
        prisma.user.create({ data: { email: `favorites-chef-${stamp}@local`, passwordHash: "x", role: "chef" } }),
        prisma.user.create({ data: { email: `favorites-admin-${stamp}@local`, passwordHash: "x", role: "admin" } }),
        prisma.user.create({ data: { email: `favorites-warehouse-${stamp}@local`, passwordHash: "x", role: "warehouse" } })
      ]);
      const category = await prisma.category.create({ data: { name: `Oblíbené ${stamp}` } });
      const item = await prisma.inventoryItem.create({ data: { categoryId: category.id, name: "Džbán" } });
      const favoritesUrl = "/inventory/favorites";
      const itemUrl = `${favoritesUrl}/${item.id}`;
      const auth = (id: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: id })}` });

      expect((await app.inject({ method: "GET", url: favoritesUrl })).statusCode).toBe(401);
      expect((await app.inject({ method: "PUT", url: itemUrl, headers: auth(chef.id) })).statusCode).toBe(403);

      const firstWrites = await Promise.all([
        app.inject({ method: "PUT", url: itemUrl, headers: auth(first.id) }),
        app.inject({ method: "PUT", url: itemUrl, headers: auth(first.id) })
      ]);
      expect(firstWrites.map((response) => response.statusCode)).toEqual([200, 200]);
      expect((await app.inject({ method: "GET", url: favoritesUrl, headers: auth(second.id) })).json()).toEqual({ itemIds: [] });
      expect((await app.inject({ method: "DELETE", url: itemUrl, headers: auth(second.id) })).statusCode).toBe(200);
      const firstFavorites = await app.inject({ method: "GET", url: favoritesUrl, headers: auth(first.id) });
      expect(firstFavorites.json()).toEqual({ itemIds: [item.id] });
      expect(firstFavorites.headers["cache-control"]).toContain("no-store");

      for (const account of [admin, warehouse]) {
        const headers = auth(account.id);
        expect((await app.inject({ method: "GET", url: favoritesUrl, headers })).json()).toEqual({ itemIds: [] });
        expect((await app.inject({ method: "PUT", url: itemUrl, headers })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: favoritesUrl, headers })).json()).toEqual({ itemIds: [item.id] });
        expect((await app.inject({ method: "DELETE", url: itemUrl, headers })).statusCode).toBe(200);
      }

      expect((await app.inject({ method: "PUT", url: itemUrl, headers: auth(second.id) })).statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: itemUrl, headers: auth(first.id) })).statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: itemUrl, headers: auth(first.id) })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: favoritesUrl, headers: auth(first.id) })).json()).toEqual({ itemIds: [] });
      expect((await app.inject({ method: "GET", url: favoritesUrl, headers: auth(second.id) })).json()).toEqual({ itemIds: [item.id] });

      await prisma.inventoryItem.delete({ where: { id: item.id } });
      expect((await app.inject({ method: "PUT", url: itemUrl, headers: auth(first.id) })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: favoritesUrl, headers: auth(second.id) })).json()).toEqual({ itemIds: [] });
    } finally {
      await app.close();
      await disconnect();
    }
  });
});
