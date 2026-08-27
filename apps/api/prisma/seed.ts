import bcrypt from "bcrypt";
import { PrismaClient, Role, LedgerReason } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Prisma 7 uz neotevira spojeni sama, klient potrebuje adapter - stejne jako
// plugins/prisma.ts. DATABASE_URL sem propada z Prisma CLI, ktera nacita .env.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed the database.");

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

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
  const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
  const existingAdmin = await prisma.user.findUnique({ where: { email: "admin@local" } });
  // Admina drzime v promenne, nize se pod nim zaklada pocatecni stav skladu.
  let admin = existingAdmin;
  if (!adminSeedPassword && existingAdmin) {
    console.log("ADMIN_SEED_PASSWORD not set; keeping existing admin credentials.");
  } else if (!adminSeedPassword) {
    throw new Error("ADMIN_SEED_PASSWORD is required to seed the admin user.");
  } else {
    const password = await bcrypt.hash(adminSeedPassword, 10);
    admin = await prisma.user.upsert({
      where: { email: "admin@local" },
      update: { name: "Admin", passwordHash: password, role: Role.admin },
      create: { email: "admin@local", name: "Admin", passwordHash: password, role: Role.admin }
    });
  }
  if (!admin) throw new Error("ADMIN_USER_MISSING");

  const emSeedPassword = process.env.EM_SEED_PASSWORD;
  if (emSeedPassword) {
    const emPassword = await bcrypt.hash(emSeedPassword, 10);
    await prisma.user.upsert({
      where: { email: "em@local" },
      update: { name: "Event manager", passwordHash: emPassword, role: Role.event_manager },
      create: { email: "em@local", name: "Event manager", passwordHash: emPassword, role: Role.event_manager }
    });
  } else {
    console.log("Skipping demo Event Manager (EM_SEED_PASSWORD not set)");
  }

  const chefSeedPassword = process.env.CHEF_SEED_PASSWORD;
  if (chefSeedPassword) {
    const chefPassword = await bcrypt.hash(chefSeedPassword, 10);
    await prisma.user.upsert({
      where: { email: "chef@local" },
      update: { name: "Kuchař", passwordHash: chefPassword, role: Role.chef },
      create: { email: "chef@local", name: "Kuchař", passwordHash: chefPassword, role: Role.chef }
    });
  } else {
    console.log("Skipping demo Chef (CHEF_SEED_PASSWORD not set)");
  }

  const warehouseSeedPassword = process.env.WAREHOUSE_SEED_PASSWORD;
  if (warehouseSeedPassword) {
    const whPassword = await bcrypt.hash(warehouseSeedPassword, 10);
    await prisma.user.upsert({
      where: { email: "warehouse@local" },
      update: { name: "Sklad", passwordHash: whPassword, role: Role.warehouse },
      create: { email: "warehouse@local", name: "Sklad", passwordHash: whPassword, role: Role.warehouse }
    });
  } else {
    console.log("Skipping demo Warehouse (WAREHOUSE_SEED_PASSWORD not set)");
  }

  // Rename legacy "Technika" to "Kuchyň" if it exists so we don't creating duplicates and items stay valid
  const legacyTech = await prisma.category.findFirst({ where: { parentId: null, name: "Technika" } });
  if (legacyTech) {
    await prisma.category.update({
      where: { id: legacyTech.id },
      data: { name: "Kuchyň" }
    });
    console.log("Renamed Technika to Kuchyň");
  }

  // Deduplication/Merge logic for parent categories
  const parents = ["Inventář", "Mobiliář", "Kuchyň", "Zboží"];
  const parentRows = new Map<string, string>();

  for (const name of parents) {
    const existing = await prisma.category.findMany({ where: { parentId: null, name }, orderBy: { createdAt: "asc" } });
    if (existing.length > 1) {
      const primary = existing[0]!;
      const duplicates = existing.slice(1);
      console.log(`Merging ${duplicates.length} duplicate(s) for category "${name}"`);
      for (const dup of duplicates) {
        // 1. Move/Merge children
        const children = await prisma.category.findMany({ where: { parentId: dup.id } });
        for (const child of children) {
          const target = await prisma.category.findFirst({ where: { parentId: primary.id, name: child.name } });
          if (target) {
            // Merge child into target subcategory
            await prisma.inventoryItem.updateMany({
              where: { categoryId: child.id },
              data: { categoryId: target.id }
            });
            // Recursively move any sub-sub-children if they exist (though not in current schema usage)
            await prisma.category.updateMany({
              where: { parentId: child.id },
              data: { parentId: target.id }
            }).catch(() => { }); // handle unique constraints if needed, but we don't expect deep nesting here

            await prisma.category.delete({ where: { id: child.id } });
          } else {
            // Move child to primary
            await prisma.category.update({
              where: { id: child.id },
              data: { parentId: primary.id }
            });
          }
        }

        // 2. Move items directly under the duplicate parent
        await prisma.inventoryItem.updateMany({
          where: { categoryId: dup.id },
          data: { categoryId: primary.id }
        });

        // 3. Move role access
        const accesses = await prisma.roleCategoryAccess.findMany({ where: { categoryId: dup.id } });
        for (const acc of accesses) {
          const existingAcc = await prisma.roleCategoryAccess.findFirst({
            where: { role: acc.role, categoryId: primary.id }
          });
          if (!existingAcc) {
            await prisma.roleCategoryAccess.update({
              where: { id: acc.id },
              data: { categoryId: primary.id }
            });
          } else {
            await prisma.roleCategoryAccess.delete({ where: { id: acc.id } });
          }
        }

        // 4. Delete duplicate
        await prisma.category.delete({ where: { id: dup.id } });
      }
      parentRows.set(name, primary.id);
    } else if (existing.length === 1) {
      parentRows.set(name, existing[0]!.id);
    } else {
      const row = await prisma.category.create({ data: { parentId: null, name } });
      parentRows.set(name, row.id);
    }
  }

  const sub = async (parent: string, name: string) => {
    const parentId = parentRows.get(parent)!;
    // Check if subcat exists under this parent
    const existing = await prisma.category.findFirst({ where: { parentId, name } });
    if (existing) return existing;
    return prisma.category.create({ data: { parentId, name } });
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
  //
  // ⚠️ POZOR: prazdna konfigurace role znamena NEOMEZENY pristup (viz
  // services/reserve.ts, blok `if (allowedAccess.length > 0)`). Zalozenim
  // prvniho radku se role prepne do omezeneho rezimu a vsechno neuvedene
  // se ji zakaze. Na produkci to 27. 8. 2026 zablokovalo event managerovi
  // 223 z 501 polozek a kuchari 464 z 501, protoze seed zna jen ctyri
  // korenove kategorie, zatimco realny katalog jich ma ctrnact.
  //
  // Tenhle blok proto patri jen do cerstveho demo prostredi. Nikdy ho
  // nepoustej proti databazi, ktera uz ma vlastni strom kategorii.
  //
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
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
