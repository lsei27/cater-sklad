import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EventStatus, LedgerReason } from "../../generated/prisma/client.js";
import { httpError } from "../lib/httpErrors.js";
import { requireRole } from "../lib/rbac.js";
import { sseBus } from "../lib/sse.js";
import { InsufficientStockError, reserveItemsTx } from "../services/reserve.js";
import { getAvailabilityForEventItemTx } from "../services/availability.js";
import { buildExportPdf, type ExportSnapshot } from "../pdf/exportPdf.js";
import { createExportTx } from "../services/export.js";
import { createInventoryLedgerEntry } from "../services/ledger.js";

function safeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function compareByCategoryParentName(a: any, b: any) {
  const aParentSort = a?.category?.parent?.sortOrder ?? a?.parentSortOrder;
  const bParentSort = b?.category?.parent?.sortOrder ?? b?.parentSortOrder;
  if (typeof aParentSort === "number" && typeof bParentSort === "number" && aParentSort !== bParentSort) {
    return aParentSort - bParentSort;
  }

  const byParent = String(a?.category?.parent?.name ?? a?.category?.parent ?? a?.parentCategory ?? a?.parent ?? "").localeCompare(
    String(b?.category?.parent?.name ?? b?.category?.parent ?? b?.parentCategory ?? b?.parent ?? ""),
    "cs"
  );
  if (byParent !== 0) return byParent;

  const aCategorySort = a?.category?.sub?.sortOrder ?? a?.category?.sortOrder ?? a?.categorySortOrder;
  const bCategorySort = b?.category?.sub?.sortOrder ?? b?.category?.sortOrder ?? b?.categorySortOrder;
  if (typeof aCategorySort === "number" && typeof bCategorySort === "number" && aCategorySort !== bCategorySort) {
    return aCategorySort - bCategorySort;
  }

  const byCategory = String(a?.category?.sub?.name ?? a?.category?.sub ?? a?.category?.name ?? a?.category ?? a?.sub ?? "").localeCompare(
    String(b?.category?.sub?.name ?? b?.category?.sub ?? b?.category?.name ?? b?.category ?? b?.sub ?? ""),
    "cs"
  );
  if (byCategory !== 0) return byCategory;

  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "cs");
}

const EventCreateSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  event_date: z.string().datetime().optional().nullable(),
  delivery_datetime: z.string().datetime(),
  pickup_datetime: z.string().datetime(),
  pallet_count: z.number().int().min(0).optional().nullable(),
  total_weight: z.string().optional().nullable()
});

const EventUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  event_date: z.string().datetime().optional().nullable(),
  delivery_datetime: z.string().datetime().optional(),
  pickup_datetime: z.string().datetime().optional(),
  pallet_count: z.number().int().min(0).optional().nullable(),
  total_weight: z.string().optional().nullable()
});

export async function eventRoutes(app: FastifyInstance) {
  app.get("/events", { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const query = z.object({
      status: z.nativeEnum(EventStatus).optional(),
      month: z.string().regex(/^\d+$/).transform(Number).optional(),
      year: z.string().regex(/^\d+$/).transform(Number).optional(),
      created_by_id: z.string().uuid().optional(),
    }).parse(request.query);

    const where: any = {};

    if (user.role === "warehouse") {
      where.status = {
        in: [
          EventStatus.DRAFT,
          EventStatus.READY_FOR_WAREHOUSE,
          EventStatus.SENT_TO_WAREHOUSE,
          EventStatus.ISSUED,
          EventStatus.CLOSED
        ]
      };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.created_by_id) {
      where.createdById = query.created_by_id;
    }

    if (query.month !== undefined && query.year !== undefined) {
      const startDate = new Date(Date.UTC(query.year, query.month - 1, 1));
      const endDate = new Date(Date.UTC(query.year, query.month, 1));
      where.deliveryDatetime = {
        gte: startDate,
        lt: endDate,
      };
    } else if (query.year !== undefined) {
      const startDate = new Date(Date.UTC(query.year, 0, 1));
      const endDate = new Date(Date.UTC(query.year + 1, 0, 1));
      where.deliveryDatetime = {
        gte: startDate,
        lt: endDate,
      };
    }

    const events = await (app.prisma.event as any).findMany({
      where,
      orderBy: { deliveryDatetime: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        deliveryDatetime: true,
        pickupDatetime: true,
        status: true,
        exportNeedsRevision: true,
        chefConfirmedAt: true,
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });
    return { events: (events as any[]) };
  });

  app.post("/events", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const body = EventCreateSchema.parse(request.body);
    const event = await app.prisma.event.create({
      data: {
        name: body.name,
        location: body.location,
        address: body.address ?? null,
        notes: body.notes ?? null,
        eventDate: body.event_date ? new Date(body.event_date) : null,
        deliveryDatetime: new Date(body.delivery_datetime),
        pickupDatetime: new Date(body.pickup_datetime),
        palletCount: body.pallet_count ?? null,
        totalWeight: body.total_weight ?? null,
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

  app.patch("/events/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = EventUpdateSchema.parse(request.body);

    const existing = await app.prisma.event.findUnique({ where: { id: params.id } });
    if (!existing) return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (existing.eventDate && existing.eventDate.getTime() < today.getTime()) {
      return httpError(reply, 403, "EVENT_IN_PAST", "Akci s datem v minulosti již nelze upravovat.");
    }

    if (["ISSUED", "CLOSED", "CANCELLED"].includes(existing.status)) {
      return httpError(reply, 409, "READ_ONLY", "Akci nelze upravit.");
    }

    const event = await app.prisma.event.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.event_date !== undefined ? { eventDate: body.event_date ? new Date(body.event_date) : null } : {}),
        ...(body.delivery_datetime !== undefined ? { deliveryDatetime: new Date(body.delivery_datetime) } : {}),
        ...(body.pickup_datetime !== undefined ? { pickupDatetime: new Date(body.pickup_datetime) } : {}),
        ...(body.pallet_count !== undefined ? { palletCount: body.pallet_count } : {}),
        ...(body.total_weight !== undefined ? { totalWeight: body.total_weight } : {})
      }
    });

    await app.prisma.auditLog.create({
      data: { actorUserId: user.id, entityType: "event", entityId: event.id, action: "update", diffJson: body }
    });

    return reply.send({ event });
  });

  app.post("/events/:id/cancel", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    try {
      const event = await app.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ id: string; status: string; created_by: string }[]>`
          SELECT id, status::text, created_by::text FROM events WHERE id = ${params.id}::uuid FOR UPDATE
        `;
        if (!row) throw new Error("NOT_FOUND");
        if (user.role === "event_manager" && row.created_by !== user.id) throw new Error("FORBIDDEN");
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
        exports: { orderBy: { version: "desc" }, take: 1 },
        returns: { include: { item: true } },
        issues: { include: { item: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    }) as any;
    if (!event) return httpError(reply, 404, "NOT_FOUND", "Event not found");
    const exports = (event.exports ?? []).map((e: any) => ({
      ...e,
      pdfUrl: `/events/${event.id}/exports/${e.version}/pdf`
    }));

    let warehouseItems: Array<{ inventoryItemId: string; name: string; unit: string; qty: number; parentCategory?: string }> = [];
    const snapshot = (exports?.[0] as any)?.snapshotJson as ExportSnapshot | undefined;
    if (snapshot?.groups?.length) {
      warehouseItems = snapshot.groups.flatMap((g) =>
        (g.items ?? []).map((it) => ({
          inventoryItemId: it.inventoryItemId,
          name: it.name,
          unit: it.unit,
          qty: it.qty,
          parentCategory: g.parentCategory
        }))
      );
    }
    if (warehouseItems.length === 0 && event.status === "ISSUED") {
      const issued = await app.prisma.$queryRaw<
        Array<{ inventory_item_id: string; issued: number; name: string; unit: string; parent_category: string }>
      >`
        SELECT
          i.inventory_item_id::text AS inventory_item_id,
          COALESCE(SUM(i.issued_quantity),0)::int AS issued,
          it.name AS name,
          it.unit AS unit,
          COALESCE(cp.name, 'Nezařazeno') AS parent_category
        FROM event_issues i
        JOIN inventory_items it ON it.id = i.inventory_item_id
        LEFT JOIN inventory_categories c ON c.id = it.category_id
        LEFT JOIN inventory_categories cp ON cp.id = c.parent_id
        WHERE i.event_id = ${event.id}::uuid AND i.type = 'issued'
        GROUP BY i.inventory_item_id, it.name, it.unit, cp.name
      `;
      warehouseItems = issued.map((r) => ({
        inventoryItemId: r.inventory_item_id,
        name: r.name,
        unit: r.unit,
        qty: Number(r.issued),
        parentCategory: r.parent_category
      }));
    }

    return { event: { ...event, exports, warehouseItems } };
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

    requireRole(request.user!.role, ["admin", "event_manager", "chef", "warehouse"]);

    const params = z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }).parse(request.params);
    const queryParams = z.object({ type: z.enum(["general", "kitchen"]).optional() }).parse(request.query);

    const row = await app.prisma.eventExport.findFirst({
      where: { eventId: params.id, version: params.version }
    });
    if (!row) return httpError(reply, 404, "NOT_FOUND", "Export not found");
    const snapshot = JSON.parse(JSON.stringify(row.snapshotJson)) as ExportSnapshot;
    if (!snapshot.event.managerName) {
      const eventManager = await app.prisma.event.findUnique({
        where: { id: params.id },
        select: { createdBy: { select: { id: true, name: true, email: true } } }
      });
      const managerLabel =
        eventManager?.createdBy?.name?.trim() ||
        eventManager?.createdBy?.email?.trim();
      if (managerLabel) {
        snapshot.event.managerName = managerLabel;
      }
    }

    let subtitle: string | undefined;
    if (queryParams.type === "kitchen") {
      snapshot.groups = snapshot.groups.filter((g) => g.parentCategory.toLowerCase() === "kuchyn" || g.parentCategory.toLowerCase() === "kuchyň");
      subtitle = "Kuchyn";
    } else if (queryParams.type === "general") {
      snapshot.groups = snapshot.groups.filter((g) => g.parentCategory.toLowerCase() !== "kuchyn" && g.parentCategory.toLowerCase() !== "kuchyň");
      subtitle = "Sklad";
    }

    try {
      const pdfBytes = await buildExportPdf(snapshot, subtitle);
      reply.header("Content-Type", "application/pdf");
      const filenameSuffix = subtitle ? `_${subtitle.toLowerCase()}` : "";
      reply.header("Content-Disposition", `inline; filename="event_${snapshot.event.id}_v${snapshot.event.version}${filenameSuffix}.pdf"`);
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

  app.get("/events/:id/cross-sells/:itemId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(request.params);
    
    const links = await app.prisma.crossSellLink.findMany({
      where: { sourceItemId: params.itemId },
      select: { targetItemId: true }
    });
    if (links.length === 0) return { items: [] };

    const targetItemIds = links.map((l) => l.targetItemId);

    const targetItems = await app.prisma.inventoryItem.findMany({
      where: { id: { in: targetItemIds }, active: true },
      include: { category: { include: { parent: true } }, warehouse: true }
    });

    if (targetItems.length === 0) return { items: [] };

    const rows = await app.prisma.$transaction(async (tx) => {
      const out: Array<{ inventoryItemId: string; physicalTotal: number; blockedTotal: number; available: number }> = [];
      for (const tId of targetItemIds) {
        const a = await getAvailabilityForEventItemTx(tx, params.id, tId);
        out.push({ inventoryItemId: tId, ...a });
      }
      return out;
    });

    const stockById = new Map(rows.map((r) => [r.inventoryItemId, r]));
    const dto = targetItems.map((it) => {
      const s = stockById.get(it.id) ?? { physicalTotal: 0, blockedTotal: 0, available: 0 };
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
          total: Number(s.physicalTotal),
          reserved: Number(s.blockedTotal),
          available: Number(s.available)
        }
      };
    });

    return { items: dto.sort(compareByCategoryParentName) };
  });

  app.get("/events/:id/cross-sell-warnings", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager", "chef"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const event = await app.prisma.event.findUnique({
      where: { id: params.id },
      include: {
        reservations: { select: { inventoryItemId: true } }
      }
    });
    if (!event) return httpError(reply, 404, "NOT_FOUND", "Event not found");

    const reservedIds = new Set(event.reservations.map(r => r.inventoryItemId));
    const dismissedIds = new Set((event.dismissedCrossSellIds || []) as string[]);

    // Find all cross-sell targets for all items in reservations
    const links = await app.prisma.crossSellLink.findMany({
      where: { sourceItemId: { in: Array.from(reservedIds) } },
      include: { targetItem: { include: { category: { include: { parent: true } } } } }
    });

    const suggestions = [];
    const seen = new Set();

    for (const link of links) {
      const targetId = link.targetItemId;
      if (!reservedIds.has(targetId) && !dismissedIds.has(targetId) && !seen.has(targetId)) {
        seen.add(targetId);
        suggestions.push({
          itemId: targetId,
          name: link.targetItem.name,
          sku: link.targetItem.sku,
          unit: link.targetItem.unit,
          category: {
            parent: link.targetItem.category.parent?.name,
            sub: link.targetItem.category.name
          }
        });
      }
    }

    return { warnings: suggestions.sort(compareByCategoryParentName) };
  });

  app.post("/events/:id/cross-sell-dismiss", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ itemId: z.string().uuid() }).parse(request.body);

    const event = await app.prisma.event.findUnique({ where: { id: params.id } });
    if (!event) return httpError(reply, 404, "NOT_FOUND", "Event not found");

    const dismissed = new Set((event.dismissedCrossSellIds || []) as string[]);
    dismissed.add(body.itemId);

    await app.prisma.event.update({
      where: { id: params.id },
      data: { dismissedCrossSellIds: Array.from(dismissed) }
    });

    return { ok: true };
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

    const eventCheck = await app.prisma.event.findUnique({
      where: { id: params.id },
      select: { eventDate: true, createdById: true }
    });
    if (!eventCheck) return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena");

    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (eventCheck.eventDate && eventCheck.eventDate.getTime() < today.getTime()) {
      return httpError(reply, 403, "EVENT_IN_PAST", "Do akce s datem v minulosti nelze přidávat položky.");
    }

    try {
      const result = await app.prisma.$transaction(async (tx) => {
        const reserveResult = await reserveItemsTx({
          tx,
          actor: user,
          eventId: params.id,
          items: body.items.map((i) => ({ inventoryItemId: i.inventory_item_id, qty: i.qty }))
        });

        const eventRow = await tx.event.findUnique({
          where: { id: params.id },
          select: { status: true, chefConfirmedAt: true, createdById: true }
        });

        if (!eventRow) throw new Error("EVENT_NOT_FOUND");

        let exportResult = null;
        if (["admin", "event_manager"].includes(user.role) && eventRow?.status === "SENT_TO_WAREHOUSE" && eventRow.chefConfirmedAt) {
          const count = await tx.eventReservation.count({
            where: { eventId: params.id, reservedQuantity: { gt: 0 } }
          });
          if (count > 0) {
            try {
              exportResult = await createExportTx({ tx, eventId: params.id, userId: user.id });
            } catch (e: any) {
              if (e.message !== "NO_ITEMS_TO_EXPORT") throw e;
            }
          }
        }

        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            entityType: "event",
            entityId: params.id,
            action: "reserve",
            diffJson: { items: body.items }
          }
        });

        return { exportResult, masterPackageAdjustments: reserveResult.masterPackageAdjustments };
      });

      sseBus.emit({ type: "reservation_changed", eventId: params.id });
      if (result.exportResult) {
        sseBus.emit({ type: "export_created", eventId: params.id, version: result.exportResult.snapshot.event.version });
      }
      return reply.send({ ok: true, masterPackageAdjustments: result.masterPackageAdjustments });
    } catch (e: any) {
      if (e instanceof InsufficientStockError) {
        return httpError(reply, 409, "INSUFFICIENT_STOCK", "Insufficient stock", {
          inventory_item_id: e.inventoryItemId,
          available: e.available
        });
      }
      if (e?.message === "CATEGORY_ACCESS_DENIED") {
        return httpError(reply, 403, "CATEGORY_ACCESS_DENIED", "Nemáte oprávnění rezervovat položky z této kategorie.");
      }
      if (e?.message === "EVENT_READ_ONLY") {
        return httpError(reply, 409, "EVENT_READ_ONLY", "Event je po výdeji uzamčen");
      }
      if (e?.message === "EVENT_NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Event not found");
      if (e?.message === "FORBIDDEN") {
        return httpError(reply, 403, "FORBIDDEN", "Nemáte oprávnění upravovat cizí akce.");
      }
      throw e;
    }
  });

  app.post("/events/:id/confirm-chef", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "chef"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    try {
      const result = await app.prisma.$transaction(async (tx) => {
        const row = await tx.event.findUnique({
          where: { id: params.id },
          select: { id: true, status: true }
        });
        if (!row) throw new Error("NOT_FOUND");
        if (row.status === "ISSUED" || row.status === "CLOSED" || row.status === "CANCELLED") throw new Error("READ_ONLY");

        await tx.eventReservation.updateMany({
          where: { eventId: params.id },
          data: { state: "confirmed", expiresAt: null }
        });

        const updated = await tx.event.update({
          where: { id: params.id },
          data: {
            chefConfirmedAt: new Date(),
          }
        });

        let exportResult = null;
        if (row.status === "SENT_TO_WAREHOUSE") {
          // Automatic export when Chef confirms in SENT_TO_WAREHOUSE status
          try {
            exportResult = await createExportTx({ tx, eventId: params.id, userId: user.id });
          } catch (e: any) {
            // If no items to export, we just ignore it for now or log
            if (e.message !== "NO_ITEMS_TO_EXPORT") throw e;
          }
        }

        await tx.auditLog.create({
          data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "confirm_chef" }
        });
        return { event: updated, exportResult };
      });

      sseBus.emit({ type: "event_status_changed", eventId: params.id, status: result.event.status });
      if (result.exportResult) {
        sseBus.emit({ type: "export_created", eventId: params.id, version: result.exportResult.snapshot.event.version });
      }
      return reply.send({ event: result.event });
    } catch (e: any) {
      if (e.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (e.message === "READ_ONLY") return httpError(reply, 409, "READ_ONLY", "Akci nelze potvrdit.");
      throw e;
    }
  });

  // Export preview - returns what would be in the export WITHOUT creating a new version
  app.get("/events/:id/export-preview", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const ev = await app.prisma.event.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, location: true, address: true, notes: true, eventDate: true, deliveryDatetime: true, pickupDatetime: true, status: true }
    });
    if (!ev) return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");

    const reservations = await app.prisma.eventReservation.findMany({
      where: { eventId: params.id, reservedQuantity: { gt: 0 } },
      include: { item: { include: { category: { include: { parent: true } } } } },
      orderBy: { inventoryItemId: "asc" }
    });

    const groupsMap = new Map<
      string,
      {
        parentCategory: string;
        category: string;
        parentSortOrder: number;
        categorySortOrder: number;
        items: Array<{ name: string; qty: number; unit: string }>;
      }
    >();
    for (const r of reservations) {
      const parentName = r.item.category.parent?.name ?? r.item.category.name;
      const categoryName = r.item.category.parent ? r.item.category.name : "";
      const parentSortOrder = r.item.category.parent?.sortOrder ?? r.item.category.sortOrder ?? 999;
      const categorySortOrder = r.item.category.parent ? (r.item.category.sortOrder ?? 999) : -1;
      const key = `${parentSortOrder}/${parentName}/${categorySortOrder}/${categoryName}`;
      const group = groupsMap.get(key) ?? (() => {
        const g = { parentCategory: parentName, category: categoryName, parentSortOrder, categorySortOrder, items: [] as any[] };
        groupsMap.set(key, g);
        return g;
      })();
      group.items.push({ name: r.item.name, qty: r.reservedQuantity, unit: r.item.unit });
    }

    const preview = {
      event: {
        name: ev.name,
        location: ev.location,
        address: ev.address,
        notes: ev.notes ?? null,
        eventDate: ev.eventDate?.toISOString() ?? null,
        deliveryDatetime: ev.deliveryDatetime.toISOString(),
        pickupDatetime: ev.pickupDatetime.toISOString()
      },
      groups: Array.from(groupsMap.values())
        .map((group) => ({
          ...group,
          items: group.items.sort((a, b) => a.name.localeCompare(b.name, "cs"))
        }))
        .sort(compareByCategoryParentName)
        .map(({ parentSortOrder, categorySortOrder, ...group }) => group),
      itemCount: reservations.length
    };

    return reply.send({ preview });
  });

  app.post("/events/:id/export", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    try {
      const created = await app.prisma.$transaction(async (tx) => {
        return await createExportTx({ tx, eventId: params.id, userId: user.id });
      });

      sseBus.emit({ type: "export_created", eventId: params.id, version: created.snapshot.event.version });
      sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "SENT_TO_WAREHOUSE" });
      return reply.send({
        export: created.exportRow,
        pdfUrl: `/events/${params.id}/exports/${created.snapshot.event.version}/pdf`
      });
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (e?.message === "READ_ONLY") return httpError(reply, 409, "READ_ONLY", "Akci nelze předat (už byla vydána/uzavřena).");
      if (e?.message === "NO_ITEMS_TO_EXPORT")
        return httpError(reply, 409, "NO_ITEMS_TO_EXPORT", "V akci nejsou žádné položky k předání.");
      request.log.error({ err: e }, "export failed");
      return httpError(reply, 500, "INTERNAL", "Internal Server Error");
    }
  });

  app.post("/events/:id/issue", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        idempotency_key: z.string().min(8).optional(),
        warehouse_id: z.string().uuid().optional(),
        items: z
          .array(
            z.object({
              inventory_item_id: z.string().uuid(),
              issued_quantity: z.number().int().min(0),
              warehouse_id: z.string().uuid().optional(),
              idempotency_key: z.string().min(8).optional()
            })
          )
          .optional()
      })
      .parse(request.body);

    try {
      const result = await app.prisma.$transaction(async (tx) => {
        const [ev] = await tx.$queryRaw<{ status: string; export_needs_revision: boolean }[]>`
          SELECT status::text, export_needs_revision FROM events WHERE id = ${params.id}::uuid FOR UPDATE
        `;
        if (!ev) throw new Error("NOT_FOUND");
        if (ev.status === "CLOSED" || ev.status === "CANCELLED") throw new Error("READ_ONLY");
        if (ev.status === "ISSUED") {
          const existing = await tx.event.findUnique({ where: { id: params.id } });
          if (!existing) throw new Error("NOT_FOUND");
          return { event: existing };
        }
        if (ev.status !== "SENT_TO_WAREHOUSE") throw new Error("BAD_STATUS");
        if (ev.export_needs_revision) throw new Error("NEEDS_REVISION");

        const latest = await tx.eventExport.findFirst({
          where: { eventId: params.id },
          orderBy: { version: "desc" }
        });
        if (!latest) throw new Error("NO_EXPORT");
        const snapshot = latest.snapshotJson as any as ExportSnapshot;
        type IssueItemInput = { inventory_item_id: string; issued_quantity: number; warehouse_id?: string; idempotency_key?: string };
        const defaultItems: IssueItemInput[] =
          body.items && body.items.length > 0
            ? (body.items as IssueItemInput[])
            : snapshot.groups.flatMap((g) =>
              g.items.map((i) => ({
                inventory_item_id: i.inventoryItemId,
                issued_quantity: i.qty,
                warehouse_id: body.warehouse_id,
                idempotency_key: undefined
              }))
            );

        const itemsToIssue = defaultItems.filter((i) => i.issued_quantity > 0);
        if (itemsToIssue.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

        const rows = itemsToIssue.map((i) => ({
          eventId: params.id,
          inventoryItemId: i.inventory_item_id,
          issuedQuantity: i.issued_quantity,
          warehouseId: i.warehouse_id ?? body.warehouse_id,
          issuedById: user.id,
          idempotencyKey: i.idempotency_key ?? `${body.idempotency_key ?? "issue"}:${params.id}:${i.inventory_item_id}`
        }));
        await tx.eventIssue.createMany({ data: rows, skipDuplicates: true });
        
        // Add Ledger entries for issued items
        for (const row of rows) {
          await createInventoryLedgerEntry(tx, {
            inventoryItemId: row.inventoryItemId,
            deltaQuantity: -row.issuedQuantity,
            reason: LedgerReason.issue,
            eventId: params.id,
            warehouseId: row.warehouseId,
            createdById: user.id,
            note: "Výdej na akci"
          });
        }

        const updated = await tx.event.update({ where: { id: params.id }, data: { status: "ISSUED" } });
        await tx.auditLog.create({
          data: { actorUserId: user.id, entityType: "event", entityId: params.id, action: "issue", diffJson: { count: rows.length } }
        });
        return { event: updated };
      });

      sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "ISSUED" });
      return reply.send(result);
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (e?.message === "READ_ONLY") return httpError(reply, 409, "READ_ONLY", "Akci nelze vydat (už je uzavřená/zrušená).");
      if (e?.message === "BAD_STATUS") return httpError(reply, 409, "BAD_STATUS", "Akci lze vydat pouze ze stavu Předáno skladu.");
      if (e?.message === "NEEDS_REVISION") return httpError(reply, 409, "NEEDS_REVISION", "Akce byla po předání změněna. Je nutný nový export.");
      if (e?.message === "NO_EXPORT") return httpError(reply, 409, "NO_EXPORT", "Akce nemá export. Nejdřív ji předej skladu.");
      if (e?.message === "NO_ITEMS_TO_ISSUE") return httpError(reply, 409, "NO_ITEMS_TO_ISSUE", "Export neobsahuje žádné položky k výdeji.");
      request.log.error({ err: e }, "issue failed");
      return httpError(reply, 500, "INTERNAL", "Internal Server Error");
    }
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
              target_warehouse_id: z.string().uuid().optional(),
              idempotency_key: z.string().min(8).optional()
            })
          )
          .default([])
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
        
        const changedLedgerItemIds: string[] = [];

        const issuedItemIds = await tx.$queryRaw<Array<{ inventory_item_id: string }>>`
          SELECT DISTINCT inventory_item_id::text AS inventory_item_id
          FROM event_issues
          WHERE event_id = ${params.id}::uuid
        `;

        if (issuedItemIds.length > 0) {
          if (body.items.length === 0) throw new Error("ITEMS_REQUIRED");
          const provided = new Set(body.items.map((i) => i.inventory_item_id));
          const missing = issuedItemIds.map((r) => r.inventory_item_id).filter((id) => !provided.has(id));
          if (missing.length > 0) throw new Error("ITEMS_INCOMPLETE");
        }

        const rows = body.items.map((i) => ({
          eventId: params.id,
          inventoryItemId: i.inventory_item_id,
          returnedQuantity: i.returned_quantity,
          brokenQuantity: i.broken_quantity,
          targetWarehouseId: i.target_warehouse_id,
          returnedById: user.id,
          idempotencyKey: i.idempotency_key ?? `${body.idempotency_key ?? "return"}:${params.id}:${i.inventory_item_id}`
        }));
        if (rows.length > 0) {
          await tx.eventReturn.createMany({ data: rows, skipDuplicates: true });
          
          // Add Ledger entries for returned items
          for (const row of rows) {
            if (row.returnedQuantity > 0) {
              await createInventoryLedgerEntry(tx, {
                inventoryItemId: row.inventoryItemId,
                deltaQuantity: row.returnedQuantity,
                reason: LedgerReason.return,
                eventId: params.id,
                warehouseId: row.targetWarehouseId,
                createdById: user.id,
                note: "Vráceno z akce"
              });
            }
            changedLedgerItemIds.push(row.inventoryItemId);
          }
        }

        const totals = await tx.$queryRaw<
          { inventory_item_id: string; issued: number; returned: number; broken: number }[]
        >`
          SELECT 
            ids.inventory_item_id::text,
            COALESCE(i.issued, 0)::int as issued,
            COALESCE(r.returned, 0)::int as returned,
            COALESCE(r.broken, 0)::int as broken
          FROM (
            SELECT DISTINCT inventory_item_id FROM event_issues WHERE event_id = ${params.id}::uuid
            UNION
            SELECT DISTINCT inventory_item_id FROM event_returns WHERE event_id = ${params.id}::uuid
          ) ids
          LEFT JOIN (
            SELECT inventory_item_id, SUM(issued_quantity) as issued
            FROM event_issues
            WHERE event_id = ${params.id}::uuid AND type = 'issued'
            GROUP BY inventory_item_id
          ) i ON i.inventory_item_id = ids.inventory_item_id
          LEFT JOIN (
            SELECT inventory_item_id, SUM(returned_quantity) as returned, SUM(broken_quantity) as broken
            FROM event_returns
            WHERE event_id = ${params.id}::uuid
            GROUP BY inventory_item_id
          ) r ON r.inventory_item_id = ids.inventory_item_id
        `;

        for (const t of totals) {
          const missing = Math.max(0, Number(t.issued) - Number(t.returned) - Number(t.broken));
          const broken = Math.max(0, Number(t.broken));
          
          // Get the warehouse where it was supposed to be returned
          const targetItem = body.items.find(i => i.inventory_item_id === t.inventory_item_id);
          const warehouseId = targetItem?.target_warehouse_id;

          if (broken > 0) {
            await tx.eventIssue.create({
              data: {
                eventId: params.id,
                inventoryItemId: t.inventory_item_id,
                issuedQuantity: broken,
                type: "broken",
                warehouseId: warehouseId,
                issuedById: user.id,
                idempotencyKey: `breakage:${params.id}:${t.inventory_item_id}:${Date.now()}`
              }
            });
            await createInventoryLedgerEntry(tx, {
              inventoryItemId: t.inventory_item_id,
              deltaQuantity: -broken,
              reason: LedgerReason.breakage,
              eventId: params.id,
              warehouseId: warehouseId,
              createdById: user.id,
              note: "Rozbité při návratu"
            });
            changedLedgerItemIds.push(t.inventory_item_id);
          }
          if (missing > 0) {
            await tx.eventIssue.create({
              data: {
                eventId: params.id,
                inventoryItemId: t.inventory_item_id,
                issuedQuantity: missing,
                type: "missing",
                warehouseId: warehouseId,
                issuedById: user.id,
                idempotencyKey: `missing:${params.id}:${t.inventory_item_id}:${Date.now()}`
              }
            });
            await createInventoryLedgerEntry(tx, {
              inventoryItemId: t.inventory_item_id,
              deltaQuantity: -missing,
              reason: LedgerReason.missing,
              eventId: params.id,
              warehouseId: warehouseId,
              createdById: user.id,
              note: "Chybějící při uzavření"
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
      if (e?.message === "ITEMS_REQUIRED") return httpError(reply, 409, "ITEMS_REQUIRED", "Pro uzavření je nutné vyplnit položky (vráceno/rozbito).");
      if (e?.message === "ITEMS_INCOMPLETE") return httpError(reply, 409, "ITEMS_INCOMPLETE", "Nechybí ti v uzavření některé položky z výdeje?");
      throw e;
    }
  });

  app.get("/events/:id/report-pdf", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "event_manager", "chef", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z.object({
      token: z.string().optional(),
      view: z.string().optional()
    }).parse(request.query);

    const event = await app.prisma.event.findUnique({
      where: { id: params.id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        issues: { include: { item: true } },
        returns: { include: { item: true } },
        reservations: { include: { item: true } }
      }
    });

    if (!event) return httpError(reply, 404, "NOT_FOUND", "Event not found");

    const { buildClosureReportPdf } = await import("../pdf/exportPdf.js");
    const pdfBytes = await buildClosureReportPdf(event as any);

    const disposition = query.view === "true" ? "inline" : "attachment";

    const safeName = safeFilename(event.name) || event.id;
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `${disposition}; filename="report-${safeName}.pdf"`)
      .send(Buffer.from(pdfBytes));
  });

  app.delete("/events/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin"]);
    if ((user.email || "").toLowerCase() !== "admin@local") {
      return httpError(reply, 403, "FORBIDDEN", "Eventy může mazat pouze účet admin@local.");
    }
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    try {
      await app.prisma.$transaction(async (tx) => {
        const event = await tx.event.findUnique({ where: { id: params.id } });
        if (!event) throw new Error("NOT_FOUND");

        // Cascade delete is handled by Prisma schema for relations except InventoryLedger (SetNull)
        // We might want to explicitly delete ledger entries linked to this event if we want "complete" clean up,
        // but schema says SetNull. For "Hard Delete" of a draft/mistake, usually there are no ledger entries yet.
        // If there are (e.g. from return breakage), they will just lose event_id.

        await tx.event.delete({ where: { id: params.id } });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            entityType: "event",
            entityId: params.id,
            action: "delete_hard",
            diffJson: { name: event.name }
          }
        });
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Event not found");
      request.log.error({ err: e }, "delete event failed");
      return httpError(reply, 500, "INTERNAL", "Internal Server Error");
    }
  });

  app.get("/events/:id/blocks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse", "event_manager", "chef"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const blocks = await app.prisma.warehouseBlock.findMany({
      where: { eventId: params.id },
      include: { item: { select: { name: true, unit: true } } },
      orderBy: { createdAt: "desc" }
    });
    return reply.send({ blocks });
  });

  app.post("/events/:id/blocks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      inventoryItemId: z.string().uuid(),
      blockedQuantity: z.number().int().min(1),
      blockedUntil: z.string().datetime(),
      note: z.string().optional()
    }).parse(request.body);

    const event = await app.prisma.event.findUnique({ where: { id: params.id } });
    if (!event) return httpError(reply, 404, "NOT_FOUND", "Event not found");
    if (event.status === "CLOSED" || event.status === "CANCELLED") {
      // Allow warehouse blocks even if event is closed? Yes, the warehouse might receive dirty items 
      // after closing and block them. So we do not restrict based on CLOSED status.
    }

    const block = await app.prisma.warehouseBlock.create({
      data: {
        eventId: params.id,
        inventoryItemId: body.inventoryItemId,
        blockedQuantity: body.blockedQuantity,
        blockedUntil: body.blockedUntil,
        note: body.note,
        createdById: user.id
      }
    });
    return reply.send({ block });
  });

  app.delete("/events/:eventId/blocks/:blockId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ eventId: z.string().uuid(), blockId: z.string().uuid() }).parse(request.params);

    const block = await app.prisma.warehouseBlock.findUnique({ where: { id: params.blockId } });
    if (!block || block.eventId !== params.eventId) {
      return httpError(reply, 404, "NOT_FOUND", "Block not found");
    }

    await app.prisma.warehouseBlock.delete({ where: { id: params.blockId } });
    return reply.send({ ok: true });
  });
}
