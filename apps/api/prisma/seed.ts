import bcrypt from "bcrypt";
import { PrismaClient, Role, LedgerReason } from "@prisma/client";

const prisma = new PrismaClient();

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

  const parents = ["Inventář", "Mobiliář", "Technika", "Zboží"];
  const parentRows = new Map<string, string>();
  for (const name of parents) {
    const row = await prisma.category.upsert({
      where: { parentId_name: { parentId: null, name } },
      update: {},
      create: { name }
    });
    parentRows.set(name, row.id);
  }

  const sub = async (parent: string, name: string) => {
    const parentId = parentRows.get(parent)!;
    return prisma.category.upsert({
      where: { parentId_name: { parentId, name } },
      update: {},
      create: { parentId, name }
    });
  };

  const catSklo = await sub("Inventář", "Sklo");
  const catTech = await sub("Technika", "Audio");

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

  const ensureQty = async (inventoryItemId: string, targetQty: number) => {
    const rows = await prisma.$queryRaw<{ physical_total: number }[]>`
      SELECT COALESCE(SUM(delta_quantity),0)::int AS physical_total
      FROM inventory_ledger
      WHERE inventory_item_id = ${inventoryItemId}::uuid
    `;
    const current = Number(rows[0]?.physical_total ?? 0);
    const delta = targetQty - current;
    if (delta !== 0) {
      await prisma.inventoryLedger.create({
        data: {
          inventoryItemId,
          deltaQuantity: delta,
          reason: LedgerReason.audit_adjustment,
          createdById: admin.id,
          note: "Seed initial stock"
        }
      });
    }
  };

  await ensureQty(item1.id, 200);
  await ensureQty(item2.id, 10);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
