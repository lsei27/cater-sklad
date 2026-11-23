import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import { eventRoutes } from "../src/routes/events.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";

describe("přístup kuchaře k akcím (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("kuchař zakládá vlastní akce a v cizí akci smí upravit jen poznámku", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const app = Fastify();
    app.decorate("prisma", prisma);
    app.register(authPlugin, { jwtSecret: randomBytes(32).toString("hex") });
    app.register(eventRoutes);

    try {
      await app.ready();
      const stamp = fixtureStamp();
      const [chef, manager] = await Promise.all([
        prisma.user.create({ data: { email: `chef-access-${stamp}@local`, passwordHash: "x", role: "chef" } }),
        prisma.user.create({ data: { email: `chef-access-em-${stamp}@local`, passwordHash: "x", role: "event_manager" } })
      ]);
      const headers = { authorization: `Bearer ${app.jwt.sign({ sub: chef.id })}` };
      const day = 24 * 60 * 60 * 1000;
      const delivery = new Date(Date.now() + 10 * day);
      const pickup = new Date(delivery.getTime() + 2 * day);

      const created = await app.inject({
        method: "POST", url: "/events", headers,
        payload: { name: `Kuchař ${stamp}`, location: "Praha", delivery_datetime: delivery.toISOString(), pickup_datetime: pickup.toISOString() }
      });
      expect(created.statusCode).toBe(200);
      const own = created.json<{ event: { id: string } }>().event;
      const ownEdit = await app.inject({ method: "PATCH", url: `/events/${own.id}`, headers, payload: { name: "Přejmenováno" } });
      expect(ownEdit.statusCode).toBe(200);

      const foreign = await prisma.event.create({
        data: { name: `EM ${stamp}`, location: "Brno", deliveryDatetime: delivery, pickupDatetime: pickup, createdById: manager.id }
      });
      const notes = await app.inject({ method: "PATCH", url: `/events/${foreign.id}`, headers, payload: { notes: "Přivézt led" } });
      expect(notes.statusCode).toBe(200);
      const rename = await app.inject({ method: "PATCH", url: `/events/${foreign.id}`, headers, payload: { name: "Cizí", notes: "x" } });
      expect(rename.statusCode).toBe(403);
      const cancel = await app.inject({ method: "POST", url: `/events/${foreign.id}/cancel`, headers });
      expect(cancel.statusCode).toBe(403);
      const exported = await app.inject({ method: "POST", url: `/events/${foreign.id}/export`, headers });
      expect(exported.statusCode).toBe(403);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(stored).toMatchObject({ name: `EM ${stamp}`, notes: "Přivézt led", status: "DRAFT" });
    } finally {
      await app.close();
      await disconnect();
    }
  });
});
