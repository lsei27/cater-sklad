import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EventStatus } from "@prisma/client";
import { httpError } from "../lib/httpErrors.js";
import { requireRole } from "../lib/rbac.js";
import { sseBus } from "../lib/sse.js";
import { InsufficientStockError, reserveItemsTx } from "../services/reserve.js";
import { getAvailabilityForEventItemTx } from "../services/availability.js";
import { buildExportPdf, type ExportSnapshot } from "../pdf/exportPdf.js";

const EventCreateSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  delivery_datetime: z.string().datetime(),
  pickup_datetime: z.string().datetime()
});

export async function eventRoutes(app: FastifyInstance) {
  app.get("/events", { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const where =
      user.role === "warehouse"
        ? { status: { in: [EventStatus.SENT_TO_WAREHOUSE, EventStatus.ISSUED] } }
        : undefined;
    const events = await app.prisma.event.findMany({
      where,
      orderBy: { deliveryDatetime: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        deliveryDatetime: true,
        pickupDatetime: true,
        status: true,
        exportNeedsRevision: true
      }
    });
    return { events };
  });

  app.post("/events", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const body = EventCreateSchema.parse(request.body);
    const event = await app.prisma.event.create({
      data: {
        name: body.name,
        location: body.location,
        deliveryDatetime: new Date(body.delivery_datetime),
        pickupDatetime: new Date(body.pickup_datetime),
        createdById: user.id
      }
    });
    await app.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        entityType: "event",
        entityId: event.id,
        action: "create",
        diffJson: body
      }
    });
    return reply.send({ event });
  });

  app.post("/events/:id/cancel", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    try {
      const event = await app.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT id, status::text FROM events WHERE id = ${params.id}::uuid FOR UPDATE
        `;
        if (!row) throw new Error("NOT_FOUND");
        if (row.status === "CLOSED") throw new Error("READ_ONLY");
        if (row.status === "ISSUED") throw new Error("ALREADY_ISSUED");
        if (row.status === "CANCELLED") return row;

        const updated = await tx.event.update({
          where: { id: params.id },
          data: { status: EventStatus.CANCELLED, exportNeedsRevision: false }
        });
        await tx.auditLog.create({
          data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "cancel", diffJson: { status: "CANCELLED" } }
        });
        return { id: updated.id, status: updated.status as any };
      });

      sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "CANCELLED" });
      return reply.send({ event });
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (msg === "READ_ONLY") return httpError(reply, 409, "READ_ONLY", "Akci nelze zrušit (už je uzavřená).");
      if (msg === "ALREADY_ISSUED") return httpError(reply, 409, "ALREADY_ISSUED", "Akci nelze zrušit (už byla vydána).");
      request.log.error({ err: e }, "cancel failed");
      return httpError(reply, 500, "INTERNAL", "Internal Server Error");
    }
  });

	  app.get("/events/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
	    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
	    const event = await app.prisma.event.findUnique({
	      where: { id },
	      include: {
        reservations: {
          include: {
            item: { include: { category: { include: { parent: true } } } }
          }
        },
	        exports: { orderBy: { version: "desc" }, take: 1 }
	      }
	    });
	    if (!event) return httpError(reply, 404, "NOT_FOUND", "Event not found");
	    const exports = (event.exports ?? []).map((e) => ({
	      ...e,
	      pdfUrl: `/events/${event.id}/exports/${e.version}/pdf`
	    }));
	    return { event: { ...event, exports } };
	  });

	  app.get("/events/:id/exports", { preHandler: [app.authenticate] }, async (request, reply) => {
	    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
	    const exports = await app.prisma.eventExport.findMany({
	      where: { eventId: id },
	      orderBy: { version: "desc" },
	      select: { id: true, eventId: true, version: true, exportedAt: true, exportedById: true, pdfPath: true, createdAt: true }
	    });
	    return {
	      exports: exports.map((e) => ({ ...e, pdfUrl: `/events/${id}/exports/${e.version}/pdf` }))
	    };
	  });

	  app.get("/events/:id/exports/:version", { preHandler: [app.authenticate] }, async (request, reply) => {
	    const params = z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }).parse(request.params);
	    const row = await app.prisma.eventExport.findFirst({
	      where: { eventId: params.id, version: params.version }
	    });
	    if (!row) return httpError(reply, 404, "NOT_FOUND", "Export not found");
	    return { export: { ...row, pdfUrl: `/events/${params.id}/exports/${row.version}/pdf` } };
	  });

  app.get("/events/:id/exports/:version/pdf", async (request, reply) => {
    // Opening a PDF in a new tab can't reliably attach Authorization header, so allow `?token=...` here.
    const query = z.object({ token: z.string().optional() }).parse(request.query);
    const token =
      query.token ??
      (typeof request.headers.authorization === "string" ? request.headers.authorization.split(" ")[1] : undefined);
    if (!token) return httpError(reply, 401, "UNAUTHENTICATED", "Missing token");
    try {
      const payload = app.jwt.verify<{ sub: string }>(token);
      const user = await app.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return httpError(reply, 401, "UNAUTHENTICATED", "Invalid token");
      (request as any).user = { id: user.id, email: user.email, role: user.role };
    } catch {
      return httpError(reply, 401, "UNAUTHENTICATED", "Invalid token");
    }

    requireRole(request.user!.role, ["admin", "event_manager", "warehouse"]);

    const params = z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }).parse(request.params);
    const row = await app.prisma.eventExport.findFirst({
      where: { eventId: params.id, version: params.version }
    });
    if (!row) return httpError(reply, 404, "NOT_FOUND", "Export not found");
    const snapshot = row.snapshotJson as any as ExportSnapshot;
    try {
      const pdfBytes = await buildExportPdf(snapshot);
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `inline; filename="event_${snapshot.event.id}_v${snapshot.event.version}.pdf"`);
      reply.header("Cache-Control", "no-store");
      return reply.send(Buffer.from(pdfBytes));
    } catch (err) {
      request.log.error({ err }, "pdf render failed");
      return httpError(reply, 500, "PDF_RENDER_FAILED", "Nepodařilo se vygenerovat PDF.");
    }
  });

  app.get("/events/:id/availability", { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        inventory_item_id: z.string().uuid().optional()
      })
      .parse(request.query);

    if (query.inventory_item_id) {
      const a = await app.prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, params.id, query.inventory_item_id!));
      return { inventoryItemId: query.inventory_item_id, ...a };
    }

    return httpError(reply, 400, "BAD_REQUEST", "inventory_item_id is required for MVP");
  });

  app.post("/events/:id/availability", { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        inventory_item_ids: z.array(z.string().uuid()).min(1)
      })
      .parse(request.body);

    const rows = await app.prisma.$transaction(async (tx) => {
      const out: Array<{ inventoryItemId: string; physicalTotal: number; blockedTotal: number; available: number }> = [];
      for (const itemId of body.inventory_item_ids) {
        const a = await getAvailabilityForEventItemTx(tx, params.id, itemId);
        out.push({ inventoryItemId: itemId, ...a });
      }
      return out;
    });
    return { rows };
  });

  app.post("/events/:id/reserve", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager", "chef"]);

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        items: z
          .array(
            z.object({
              inventory_item_id: z.string().uuid(),
              qty: z.number().int().min(0)
            })
          )
          .min(1)
      })
      .parse(request.body);

    try {
      const result = await app.prisma.$transaction(async (tx) => {
        await reserveItemsTx({
          tx,
          actor: user,
          eventId: params.id,
          items: body.items.map((i) => ({ inventoryItemId: i.inventory_item_id, qty: i.qty }))
        });

        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            entityType: "event",
            entityId: params.id,
            action: "reserve",
            diffJson: { items: body.items }
          }
        });
      });

      sseBus.emit({ type: "reservation_changed", eventId: params.id });
      return reply.send({ ok: true });
    } catch (e: any) {
      if (e instanceof InsufficientStockError) {
        return httpError(reply, 409, "INSUFFICIENT_STOCK", "Insufficient stock", {
          inventory_item_id: e.inventoryItemId,
          available: e.available
        });
      }
      if (e?.message === "CHEF_ONLY_TECH") {
        return httpError(reply, 403, "CHEF_ONLY_TECH", "Chef může rezervovat pouze Techniku");
      }
      if (e?.message === "EVENT_READ_ONLY") {
        return httpError(reply, 409, "EVENT_READ_ONLY", "Event je po výdeji uzamčen");
      }
      if (e?.message === "EVENT_NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Event not found");
      throw e;
    }
  });

  app.post("/events/:id/confirm-chef", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "chef"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const event = await app.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status::text FROM events WHERE id = ${params.id}::uuid FOR UPDATE
      `;
      if (!row) throw new Error("NOT_FOUND");
      if (row.status === "ISSUED" || row.status === "CLOSED" || row.status === "CANCELLED") throw new Error("READ_ONLY");
      await tx.eventReservation.updateMany({
        where: { eventId: params.id },
        data: { state: "confirmed", expiresAt: null }
      });
      const updated = await tx.event.update({
        where: { id: params.id },
        data: { status: "READY_FOR_WAREHOUSE" }
      });
      await tx.auditLog.create({
        data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "confirm_chef" }
      });
      return updated;
    });

    sseBus.emit({ type: "event_status_changed", eventId: params.id, status: event.status });
    return reply.send({ event });
  });

  app.post("/events/:id/export", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const created = await app.prisma.$transaction(async (tx) => {
      const [ev] = await tx.$queryRaw<
        { id: string; name: string; location: string; delivery_datetime: Date; pickup_datetime: Date; status: string }[]
      >`
        SELECT id, name, location, delivery_datetime, pickup_datetime, status::text
        FROM events
        WHERE id = ${params.id}::uuid
        FOR UPDATE
      `;
      if (!ev) throw new Error("NOT_FOUND");
      if (ev.status === "ISSUED" || ev.status === "CLOSED" || ev.status === "CANCELLED") throw new Error("READ_ONLY");

	      const [v] = await tx.$queryRaw<{ next_version: number }[]>`
	        SELECT COALESCE(MAX(version),0) + 1 AS next_version
	        FROM event_exports
	        WHERE event_id = ${params.id}::uuid
	      `;
	      const version = Number(v?.next_version ?? 1);

      const reservations = await tx.eventReservation.findMany({
        where: { eventId: params.id, state: "confirmed" },
        include: { item: { include: { category: { include: { parent: true } } } } },
        orderBy: { inventoryItemId: "asc" }
      });

      const groupsMap = new Map<string, ExportSnapshot["groups"][number]>();
      for (const r of reservations) {
        const child = r.item.category;
        const parentName = child.parent?.name ?? "Nezařazeno";
        const key = `${parentName}||${child.name}`;
        const group =
          groupsMap.get(key) ??
          (() => {
            const g = { parentCategory: parentName, category: child.name, items: [] as any[] };
            groupsMap.set(key, g);
            return g;
          })();
        group.items.push({
          inventoryItemId: r.inventoryItemId,
          name: r.item.name,
          unit: r.item.unit,
          qty: r.reservedQuantity,
          notes: r.item.notes
        });
      }

      const exportedAt = new Date();
      const snapshot: ExportSnapshot = {
        event: {
          id: ev.id,
          name: ev.name,
          location: ev.location,
          deliveryDatetime: ev.delivery_datetime.toISOString(),
          pickupDatetime: ev.pickup_datetime.toISOString(),
          version,
          exportedAt: exportedAt.toISOString()
        },
        groups: Array.from(groupsMap.values())
      };

      const exportRow = await tx.eventExport.create({
        data: {
          eventId: params.id,
          version,
          exportedAt,
          exportedById: user.id,
          snapshotJson: snapshot
        }
      });

      await tx.event.update({
        where: { id: params.id },
        data: { status: "SENT_TO_WAREHOUSE", exportNeedsRevision: false }
      });

      await tx.auditLog.create({
        data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "export_created", diffJson: { version } }
      });

      return { exportRow, snapshot };
    });

    sseBus.emit({ type: "export_created", eventId: params.id, version: created.snapshot.event.version });
    sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "SENT_TO_WAREHOUSE" });
    return reply.send({
      export: created.exportRow,
      pdfUrl: `/events/${params.id}/exports/${created.snapshot.event.version}/pdf`
    });
  });

  app.post("/events/:id/issue", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        idempotency_key: z.string().min(8).optional(),
        items: z
          .array(
            z.object({
              inventory_item_id: z.string().uuid(),
              issued_quantity: z.number().int().min(0),
              idempotency_key: z.string().min(8).optional()
            })
          )
          .optional()
      })
      .parse(request.body);

    const result = await app.prisma.$transaction(async (tx) => {
      const [ev] = await tx.$queryRaw<{ status: string; export_needs_revision: boolean }[]>`
        SELECT status::text, export_needs_revision FROM events WHERE id = ${params.id}::uuid FOR UPDATE
      `;
      if (!ev) throw new Error("NOT_FOUND");
      if (ev.status === "CLOSED" || ev.status === "CANCELLED") throw new Error("READ_ONLY");
      if (ev.export_needs_revision) throw new Error("NEEDS_REVISION");

      const latest = await tx.eventExport.findFirst({
        where: { eventId: params.id },
        orderBy: { version: "desc" }
      });
      if (!latest) throw new Error("NO_EXPORT");
      const snapshot = latest.snapshotJson as any as ExportSnapshot;
      type IssueItemInput = { inventory_item_id: string; issued_quantity: number; idempotency_key?: string };
      const defaultItems: IssueItemInput[] =
        body.items && body.items.length > 0
          ? (body.items as IssueItemInput[])
          : snapshot.groups.flatMap((g) =>
              g.items.map((i) => ({
                inventory_item_id: i.inventoryItemId,
                issued_quantity: i.qty,
                idempotency_key: undefined
              }))
            );

      const rows = defaultItems.map((i) => ({
        eventId: params.id,
        inventoryItemId: i.inventory_item_id,
        issuedQuantity: i.issued_quantity,
        issuedById: user.id,
        idempotencyKey: i.idempotency_key ?? `${body.idempotency_key ?? "issue"}:${params.id}:${i.inventory_item_id}`
      }));
      await tx.eventIssue.createMany({ data: rows, skipDuplicates: true });
      const updated = await tx.event.update({ where: { id: params.id }, data: { status: "ISSUED" } });
      await tx.auditLog.create({
        data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "issue", diffJson: { count: rows.length } }
      });
      return { event: updated };
    });

    sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "ISSUED" });
    return reply.send(result);
  });

  app.post("/events/:id/return-close", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        idempotency_key: z.string().min(8).optional(),
        items: z
          .array(
            z.object({
              inventory_item_id: z.string().uuid(),
              returned_quantity: z.number().int().min(0),
              broken_quantity: z.number().int().min(0).default(0),
              idempotency_key: z.string().min(8).optional()
            })
          )
          .min(1)
      })
      .parse(request.body);

    try {
      const out = await app.prisma.$transaction(async (tx) => {
        const [ev] = await tx.$queryRaw<{ status: string }[]>`
          SELECT status::text FROM events WHERE id = ${params.id}::uuid FOR UPDATE
        `;
        if (!ev) throw new Error("NOT_FOUND");
        if (ev.status === "CLOSED") return { alreadyClosed: true };
        if (ev.status !== "ISSUED") throw new Error("NOT_ISSUED");

        const rows = body.items.map((i) => ({
          eventId: params.id,
          inventoryItemId: i.inventory_item_id,
          returnedQuantity: i.returned_quantity,
          brokenQuantity: i.broken_quantity,
          returnedById: user.id,
          idempotencyKey: i.idempotency_key ?? `${body.idempotency_key ?? "return"}:${params.id}:${i.inventory_item_id}`
        }));
        await tx.eventReturn.createMany({ data: rows, skipDuplicates: true });

        const totals = await tx.$queryRaw<
          { inventory_item_id: string; issued: number; returned: number; broken: number }[]
        >`
          SELECT
            i.inventory_item_id::text,
            COALESCE(SUM(i.issued_quantity),0)::int AS issued,
            COALESCE(SUM(r.returned_quantity),0)::int AS returned,
            COALESCE(SUM(r.broken_quantity),0)::int AS broken
          FROM event_issues i
          LEFT JOIN event_returns r
            ON r.event_id = i.event_id AND r.inventory_item_id = i.inventory_item_id
          WHERE i.event_id = ${params.id}::uuid
          GROUP BY i.inventory_item_id
        `;

        const changedLedgerItemIds: string[] = [];
        for (const t of totals) {
          const missing = Math.max(0, Number(t.issued) - Number(t.returned) - Number(t.broken));
          const broken = Math.max(0, Number(t.broken));
          if (broken > 0) {
            await tx.inventoryLedger.create({
              data: {
                inventoryItemId: t.inventory_item_id,
                deltaQuantity: -broken,
                reason: "breakage",
                eventId: params.id,
                createdById: user.id,
                note: "Breakage on return/close"
              }
            });
            changedLedgerItemIds.push(t.inventory_item_id);
          }
          if (missing > 0) {
            await tx.inventoryLedger.create({
              data: {
                inventoryItemId: t.inventory_item_id,
                deltaQuantity: -missing,
                reason: "missing",
                eventId: params.id,
                createdById: user.id,
                note: "Missing on close"
              }
            });
            changedLedgerItemIds.push(t.inventory_item_id);
          }
        }

        await tx.event.update({ where: { id: params.id }, data: { status: "CLOSED" } });
        await tx.auditLog.create({
          data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "return_close", diffJson: { items: body.items } }
        });
        return { alreadyClosed: false, changedLedgerItemIds };
      });

      if (!out.alreadyClosed) {
        sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "CLOSED" });
        sseBus.emit({ type: "reservation_changed", eventId: params.id });
        for (const inventoryItemId of out.changedLedgerItemIds ?? []) {
          sseBus.emit({ type: "ledger_changed", inventoryItemId });
        }
      }
      return reply.send(out);
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Event not found");
      if (e?.message === "NOT_ISSUED") return httpError(reply, 409, "NOT_ISSUED", "Event není ve stavu ISSUED");
      throw e;
    }
  });
}
