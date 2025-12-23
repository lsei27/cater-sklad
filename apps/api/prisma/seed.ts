import bcrypt from "bcrypt";
import { PrismaClient, Role, LedgerReason } from "@prisma/client";

const prisma = new PrismaClient();

async function getOrCreateCategory(params: { parentId: string | null; name: string }) {
  const { parentId, name } = params;
  const existing = await prisma.category.findFirst({ where: { parentId, name } });
  if (existing) return existing;
  try {
    return await prisma.category.create({ data: { parentId, name } });
  } catch {
    const again = await prisma.category.findFirst({ where: { parentId, name } });
    if (!again) throw new Error("CATEGORY_CREATE_FAILED");
    return again;
  }
}

async function main() {
  const password = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@local" },
    update: {},
    create: { email: "admin@local", passwordHash: password, role: Role.admin }
  });

  const emPassword = await bcrypt.hash("em123", 10);
  const chefPassword = await bcrypt.hash("chef123", 10);
  const whPassword = await bcrypt.hash("wh123", 10);

  await prisma.user.upsert({
    where: { email: "em@local" },
    update: {},
    create: { email: "em@local", passwordHash: emPassword, role: Role.event_manager }
  });
  await prisma.user.upsert({
    where: { email: "chef@local" },
    update: {},
    create: { email: "chef@local", passwordHash: chefPassword, role: Role.chef }
  });
  await prisma.user.upsert({
    where: { email: "warehouse@local" },
    update: {},
    create: { email: "warehouse@local", passwordHash: whPassword, role: Role.warehouse }
  });

  // Rename legacy "Technika" to "Kuchyň" if it exists so we don't creating duplicates and items stay valid
  const legacyTech = await prisma.category.findFirst({ where: { parentId: null, name: "Technika" } });
  if (legacyTech) {
    await prisma.category.update({
      where: { id: legacyTech.id },
      data: { name: "Kuchyň" }
    });
    console.log("Renamed Technika to Kuchyň");
  }

  const parents = ["Inventář", "Mobiliář", "Kuchyň", "Zboží"];
  const parentRows = new Map<string, string>();
  for (const name of parents) {
    const row = await getOrCreateCategory({ parentId: null, name });
    parentRows.set(name, row.id);
  }

  const sub = async (parent: string, name: string) => {
    const parentId = parentRows.get(parent)!;
    return getOrCreateCategory({ parentId, name });
  };

  const catSklo = await sub("Inventář", "Sklo");
  const catTech = await sub("Kuchyň", "Audio");

  const item1 = await prisma.inventoryItem.upsert({
    where: { sku: "SKLO-001" },
    update: { name: "Sklenice na víno", categoryId: catSklo.id, unit: "ks", returnDelayDays: 0 },
    create: {
      name: "Sklenice na víno",
      categoryId: catSklo.id,
      unit: "ks",
      returnDelayDays: 0,
      sku: "SKLO-001"
    }
  });
  const item2 = await prisma.inventoryItem.upsert({
    where: { sku: "TECH-001" },
    update: { name: "Bluetooth reproduktor", categoryId: catTech.id, unit: "ks", returnDelayDays: 1 },
    create: {
      name: "Bluetooth reproduktor",
      categoryId: catTech.id,
      unit: "ks",
      returnDelayDays: 1,
      sku: "TECH-001"
    }
  });

  const ensureInitialQtyIfNoLedger = async (inventoryItemId: string, targetQty: number) => {
    const [{ ledger_count } = { ledger_count: 0 }] = await prisma.$queryRaw<{ ledger_count: number }[]>`
      SELECT COUNT(*)::int AS ledger_count
      FROM inventory_ledger
      WHERE inventory_item_id = ${inventoryItemId}::uuid
    `;
    if (Number(ledger_count) > 0) return;
    await prisma.inventoryLedger.create({
      data: {
        inventoryItemId,
        deltaQuantity: targetQty,
        reason: LedgerReason.audit_adjustment,
        createdById: admin.id,
        note: "Seed initial stock"
      }
    });
  };

  await ensureInitialQtyIfNoLedger(item1.id, 200);
  await ensureInitialQtyIfNoLedger(item2.id, 10);

  // Seed Role Category Access
  // Chef -> Kuchyň
  const kitchenCat = parentRows.get("Kuchyň");
  if (kitchenCat) {
    const access = await prisma.roleCategoryAccess.findFirst({
      where: { role: Role.chef, categoryId: kitchenCat }
    });
    if (!access) {
      await prisma.roleCategoryAccess.create({
        data: { role: Role.chef, categoryId: kitchenCat }
      });
    }
  }

  // Event Manager -> All (or explicit list, let's give them everything for now to match legacy behavior)
  for (const [name, id] of parentRows.entries()) {
    const existing = await prisma.roleCategoryAccess.findFirst({ where: { role: Role.event_manager, categoryId: id } });
    if (!existing) {
      await prisma.roleCategoryAccess.create({ data: { role: Role.event_manager, categoryId: id } });
    }
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
