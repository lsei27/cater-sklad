import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { requireRole } from "../lib/rbac.js";
import { httpError } from "../lib/httpErrors.js";
import { getPhysicalTotal } from "../services/availability.js";
import { sseBus } from "../lib/sse.js";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";

function parseBool(v: unknown) {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return undefined;
}

const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[^\s@]+@[^\s@]+(\.[^\s@]+)?$/, "Invalid email");

const ImageUrlSchema = z.preprocess(
  (v) => (v === "" ? null : v),
  z
    .union([z.string().url(), z.string().regex(/^\/storage\/[^\s]+$/, "Invalid image path")])
    .nullable()
);

async function getOrCreateCategory(params: {
  tx: any;
  parentId: string | null;
  name: string;
}) {
  const { tx, parentId, name } = params;
  const existing = await tx.category.findFirst({ where: { parentId, name } });
  if (existing) return existing;
  try {
    return await tx.category.create({ data: { parentId, name } });
  } catch {
    const again = await tx.category.findFirst({ where: { parentId, name } });
    if (!again) throw new Error("CATEGORY_CREATE_FAILED");
    return again;
  }
}

export async function adminRoutes(app: FastifyInstance) {
  app.post("/admin/categories", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const body = z.object({ name: z.string().min(1), parent_id: z.string().uuid().nullable().optional() }).parse(request.body);
    const parentId = body.parent_id ?? null;
    const row = await getOrCreateCategory({
      tx: app.prisma,
      parentId,
      name: body.name
    });
    await app.prisma.auditLog.create({
      data: { actorUserId: actor.id, entityType: "category", entityId: row.id, action: "upsert", diffJson: body }
    });
    return reply.send({ category: row });
  });

  app.patch("/admin/categories/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    const row = await app.prisma.category.update({ where: { id: params.id }, data: { name: body.name } });
    await app.prisma.auditLog.create({
      data: { actorUserId: actor.id, entityType: "category", entityId: row.id, action: "update", diffJson: body }
    });
    return reply.send({ category: row });
  });

  app.get("/admin/users", { preHandler: [app.authenticate] }, async (request) => {
    requireRole(request.user!.role, ["admin"]);
    const users = await app.prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, role: true } });
    return { users };
  });

  app.post("/admin/users", { preHandler: [app.authenticate] }, async (request, reply) => {
    requireRole(request.user!.role, ["admin"]);
    const body = z
      .object({
        email: EmailSchema,
        password: z.string().min(6),
        role: z.enum(["admin", "event_manager", "chef", "warehouse"])
      })
      .parse(request.body);
    const bcrypt = await import("bcrypt");
    const hash = await bcrypt.default.hash(body.password, 10);
    const user = await app.prisma.user.create({ data: { email: body.email, passwordHash: hash, role: body.role as any } });
    await app.prisma.auditLog.create({
      data: { actorUserId: request.user!.id, entityType: "user", entityId: user.id, action: "create", diffJson: { email: body.email, role: body.role } }
    });
    return reply.send({ user: { id: user.id, email: user.email, role: user.role } });
  });

  app.delete("/admin/users/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    if (params.id === actor.id) {
      return httpError(reply, 400, "BAD_REQUEST", "Nemůžeš smazat sám sebe.");
    }

    try {
      await app.prisma.$transaction(async (tx) => {
        // Check if user has related entities that prevent deletion (restrict)
        // Or rely on foreign keys. Let's try direct delete and catch FK errors.
        await tx.user.delete({ where: { id: params.id } });
        await tx.auditLog.create({
          data: { actorUserId: actor.id, entityType: "user", entityId: params.id, action: "delete" }
        });
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      if (e?.code === "P2003") { // Foreign key constraint failed
        return httpError(reply, 409, "CONFLICT", "Uživatel má navázaná data (akce, exporty, atd.) a nelze ho smazat.");
      }
      if (e?.code === "P2025") { // Record not found
        return httpError(reply, 404, "NOT_FOUND", "Uživatel nenalezen.");
      }
      request.log.error({ err: e }, "delete user failed");
      return httpError(reply, 500, "INTERNAL", "Interní chyba.");
    }
  });

  app.get("/admin/items", { preHandler: [app.authenticate] }, async (request) => {
    requireRole(request.user!.role, ["admin"]);
    const query = z.object({ search: z.string().optional() }).parse(request.query);
    const items = await app.prisma.inventoryItem.findMany({
      where: query.search ? { name: { contains: query.search, mode: "insensitive" } } : {},
      orderBy: { createdAt: "desc" },
      include: { category: { include: { parent: true } } }
    });
    return { items };
  });

  app.post("/admin/items", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const body = z
      .object({
        name: z.string().min(1),
        category_id: z.string().uuid(),
        unit: z.string().min(1).default("ks"),
        image_url: ImageUrlSchema.optional(),
        active: z.boolean().optional(),
        return_delay_days: z.number().int().min(0).optional(),
        sku: z.string().min(1).nullable().optional(),
        notes: z.string().nullable().optional()
      })
      .parse(request.body);
    const item = await app.prisma.inventoryItem.create({
      data: {
        name: body.name,
        categoryId: body.category_id,
        unit: body.unit,
        imageUrl: body.image_url ?? null,
        active: body.active ?? true,
        returnDelayDays: body.return_delay_days ?? 0,
        sku: body.sku ?? null,
        notes: body.notes ?? null
      }
    });
    await app.prisma.auditLog.create({
      data: { actorUserId: actor.id, entityType: "inventory_item", entityId: item.id, action: "create", diffJson: body }
    });
    sseBus.emit({ type: "ledger_changed", inventoryItemId: item.id });
    return reply.send({ item });
  });

  app.patch("/admin/items/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        category_id: z.string().uuid().optional(),
        unit: z.string().min(1).optional(),
        image_url: ImageUrlSchema.optional(),
        active: z.boolean().optional(),
        return_delay_days: z.number().int().min(0).optional(),
        sku: z.string().min(1).nullable().optional(),
        notes: z.string().nullable().optional()
      })
      .parse(request.body);
    const item = await app.prisma.inventoryItem.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.category_id !== undefined ? { categoryId: body.category_id } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.image_url !== undefined ? { imageUrl: body.image_url } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.return_delay_days !== undefined ? { returnDelayDays: body.return_delay_days } : {}),
        ...(body.sku !== undefined ? { sku: body.sku } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {})
      }
    });
    await app.prisma.auditLog.create({
      data: { actorUserId: actor.id, entityType: "inventory_item", entityId: item.id, action: "update", diffJson: body }
    });
    return reply.send({ item });
  });

  app.delete("/admin/items/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const result = await app.prisma.$transaction(async (tx) => {
      // Deep hard delete - remove all related records
      await tx.inventoryLedger.deleteMany({ where: { inventoryItemId: params.id } });
      await tx.eventReservation.deleteMany({ where: { inventoryItemId: params.id } });
      await tx.eventIssue.deleteMany({ where: { inventoryItemId: params.id } });
      await tx.eventReturn.deleteMany({ where: { inventoryItemId: params.id } });

      const deleted = await tx.inventoryItem.delete({ where: { id: params.id } });
      await tx.auditLog.create({
        data: { actorUserId: actor.id, entityType: "inventory_item", entityId: deleted.id, action: "delete" }
      });
      return { mode: "deleted" as const, itemId: deleted.id };
    });

    sseBus.emit({ type: "ledger_changed", inventoryItemId: params.id });
    return reply.send(result);
  });

  app.post("/admin/items/:id/image", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const file = await (request as any).file?.();
    if (!file) return httpError(reply, 400, "BAD_REQUEST", "Send multipart/form-data with field 'file'.");

    if (typeof file.mimetype === "string" && !file.mimetype.startsWith("image/")) {
      return httpError(reply, 400, "BAD_REQUEST", "Only image uploads are allowed.");
    }

    const extRaw = path.extname(String(file.filename ?? "")).toLowerCase();
    const ext = [".png", ".jpg", ".jpeg", ".webp"].includes(extRaw) ? extRaw : ".bin";
    const filename = `item_${params.id}_${crypto.randomUUID()}${ext}`;
    const absPath = path.join(app.config.storageDir, filename);
    await pipeline(file.file, createWriteStream(absPath));

    const urlPath = `/storage/${filename}`;
    const item = await app.prisma.inventoryItem.update({ where: { id: params.id }, data: { imageUrl: urlPath } });
    await app.prisma.auditLog.create({
      data: { actorUserId: actor.id, entityType: "inventory_item", entityId: item.id, action: "image_upload", diffJson: { imageUrl: urlPath } }
    });
    return reply.send({ itemId: item.id, imageUrl: item.imageUrl });
  });

  app.post("/admin/import/csv", { preHandler: [app.authenticate] }, async (request, reply) => {
    const actor = request.user!;
    requireRole(actor.role, ["admin"]);
    const dryRun = z.object({ dry_run: z.coerce.boolean().optional() }).parse(request.query).dry_run ?? false;
    const raw = (request.body as any) ?? "";
    if (typeof raw !== "string") return httpError(reply, 400, "BAD_REQUEST", "Send CSV as text/plain body");

    const records = parse(raw, {
      delimiter: ";",
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Array<Record<string, string>>;

    const report = {
      created_parents: [] as string[],
      created_subcats: [] as string[],
      created_items: [] as string[],
      updated_items: [] as string[],
      ledger_adjustments: [] as Array<{ sku?: string; name: string; delta: number }>,
      changed_item_ids: [] as string[],
      errors: [] as Array<{ row: number; error: string }>
    };

    if (dryRun) return reply.send({ dry_run: true, rows: records.length });

    const changedItemIds = new Set<string>();
    await app.prisma.$transaction(async (tx) => {
      for (let idx = 0; idx < records.length; idx++) {
        const r = records[idx]!;
        try {
          const name = (r.name ?? "").trim();
          const parentName = (r.parent_category ?? "").trim();
          const subName = (r.category ?? "").trim();
          const quantity = Number(String(r.quantity ?? "0").trim());
          const returnDelayDays = Number(String(r.return_delay_days ?? "0").trim());
          const unit = (r.unit ?? "ks").trim() || "ks";
          const sku = (r.sku ?? "").trim() || null;
          const notes = (r.notes ?? "").trim() || null;
          const imageUrl = (r.image_url ?? "").trim() || null;
          const active = parseBool(r.active) ?? true;

          if (!name || !parentName || !subName) throw new Error("Missing name/parent_category/category");

          const parent = await getOrCreateCategory({ tx, parentId: null, name: parentName });
          const child = await getOrCreateCategory({ tx, parentId: parent.id, name: subName });

          const existing = sku
            ? await tx.inventoryItem.findUnique({ where: { sku } })
            : await tx.inventoryItem.findFirst({ where: { name, categoryId: child.id } });

          const item = existing
            ? await tx.inventoryItem.update({
              where: { id: existing.id },
              data: { name, categoryId: child.id, unit, returnDelayDays, notes, imageUrl, active, sku: sku ?? undefined }
            })
            : await tx.inventoryItem.create({
              data: { name, categoryId: child.id, unit, returnDelayDays, notes, imageUrl, active, sku }
            });

          if (existing) report.updated_items.push(item.id);
          else report.created_items.push(item.id);

          const current = await getPhysicalTotal(tx, item.id);
          const delta = quantity - current;
          if (delta !== 0) {
            await tx.inventoryLedger.create({
              data: {
                inventoryItemId: item.id,
                deltaQuantity: delta,
                reason: "audit_adjustment",
                createdById: actor.id,
                note: `CSV import set quantity=${quantity} (was ${current})`
              }
            });
            report.ledger_adjustments.push({ sku: sku ?? undefined, name, delta });
            changedItemIds.add(item.id);
          }
        } catch (e: any) {
          report.errors.push({ row: idx + 1, error: e?.message ?? String(e) });
        }
      }
    });

    report.changed_item_ids = Array.from(changedItemIds);
    for (const inventoryItemId of report.changed_item_ids) {
      sseBus.emit({ type: "ledger_changed", inventoryItemId });
    }
    return reply.send(report);
  });


  app.get("/admin/role-access", { preHandler: [app.authenticate] }, async (request) => {
    requireRole(request.user!.role, ["admin"]);
    const access = await app.prisma.roleCategoryAccess.findMany({
      include: { category: true }
    });
    return { access };
  });

  app.post("/admin/role-access", { preHandler: [app.authenticate] }, async (request, reply) => {
    requireRole(request.user!.role, ["admin"]);
    const body = z.object({
      role: z.enum(["admin", "event_manager", "chef", "warehouse"]),
      category_ids: z.array(z.string().uuid())
    }).parse(request.body);

    const result = await app.prisma.$transaction(async (tx) => {
      // Remove existing for this role
      await tx.roleCategoryAccess.deleteMany({ where: { role: body.role as any } });

      // Create new
      if (body.category_ids.length > 0) {
        await tx.roleCategoryAccess.createMany({
          data: body.category_ids.map((id) => ({
            role: body.role as any,
            categoryId: id
          }))
        });
      }
      return tx.roleCategoryAccess.findMany({ where: { role: body.role as any } });
    });

    await app.prisma.auditLog.create({
      data: { actorUserId: request.user!.id, entityType: "role_access", entityId: "config", action: "update", diffJson: body }
    });

    return reply.send({ access: result });
  });
}
