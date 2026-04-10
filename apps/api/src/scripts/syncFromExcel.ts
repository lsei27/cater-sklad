import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";
import { execSync } from "node:child_process";
import path from "node:path";

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  
  console.log("读取 Excel 数据...");
  const pythonPath = "../../.venv/bin/python3"; // Path to python in root venv
  const scriptPath = "src/scripts/parse_excel.py";
  const excelPath = path.resolve("../../Sklad_new.xlsx");
  
  let data: any[];
  try {
    const output = execSync(`${pythonPath} ${scriptPath} "${excelPath}"`, { encoding: "utf8" });
    data = JSON.parse(output);
  } catch (err) {
    console.error("❌ Failed to parse Excel:", err);
    process.exit(1);
  }

  console.log(`📦 Found ${data.length} items in Excel.`);

  if (isDryRun) {
    console.log("⚠️ DRY RUN: No changes will be applied.");
  } else {
    console.log("🚨 CLEANING DATABASE...");
    // Order matters for constraints
    await prisma.eventReservation.deleteMany();
    await prisma.inventoryLedger.deleteMany();
    await prisma.eventIssue.deleteMany();
    await prisma.eventReturn.deleteMany();
    await prisma.warehouseBlock.deleteMany();
    await prisma.warehouseTransfer.deleteMany();
    await prisma.inventoryItem.deleteMany();
    // We keep categories for now, but we will update them
    console.log("✅ Database cleaned.");
  }

  // Ensure "Liboc" warehouse exists
  let warehouseId: string | undefined;
  if (!isDryRun) {
    const warehouse = await prisma.warehouse.upsert({
      where: { name: "Liboc" },
      update: {},
      create: { name: "Liboc" }
    });
    warehouseId = warehouse.id;
  }

  // Use a map for categories to handle nesting and caching
  const categoryCache = new Map<string, string>();

  console.log("🚀 Syncing items...");
  let count = 0;

  for (const item of data) {
    const name = item.name?.trim();
    const catName = item.category;
    const parentCatName = item.parent_category;
    const sku = item.Inventory === "Liboc" ? null : String(item.Inventory); // If Inventory is just location, ignore as SKU
    const unit = item.unit || "ks";
    const masterPackageQty = item["master package"] ? parseInt(String(item["master package"])) : null;
    const masterPackageWeight = item["master package weight"];
    const initialQuantity = item.quantity ? parseInt(String(item.quantity)) : 0;

    if (!name) continue;

    if (isDryRun) {
      console.log(` - Would add item: ${name} (Category: ${catName})`);
      count++;
      continue;
    }

    // 1. Get/Create Parent Category if exists
    let parentId: string | null = null;
    if (parentCatName) {
      const parentSlug = `parent:${parentCatName}`;
      if (categoryCache.has(parentSlug)) {
        parentId = categoryCache.get(parentSlug)!;
      } else {
        let cat = await prisma.category.findFirst({
          where: { parentId: null, name: parentCatName }
        });
        if (!cat) {
          cat = await prisma.category.create({
            data: { name: parentCatName, parentId: null }
          });
        }
        parentId = cat.id;
        categoryCache.set(parentSlug, cat.id);
      }
    }

    // 2. Get/Create Child Category
    let categoryId: string;
    const catSlug = `${parentId}:${catName || "Ostatní"}`;
    if (categoryCache.has(catSlug)) {
      categoryId = categoryCache.get(catSlug)!;
    } else {
      let cat = await prisma.category.findFirst({
        where: { parentId: parentId, name: catName || "Ostatní" }
      });
      if (!cat) {
        cat = await prisma.category.create({
          data: { name: catName || "Ostatní", parentId: parentId }
        });
      }
      categoryId = cat.id;
      categoryCache.set(catSlug, cat.id);
    }

    // 3. Create Item
    const newItem = await prisma.inventoryItem.create({
      data: {
        name,
        sku: sku || undefined,
        unit,
        categoryId,
        warehouseId,
        masterPackageQty,
        masterPackageWeight: masterPackageWeight ? String(masterPackageWeight) : null,
      }
    });

    // 4. Initial stock entry
    if (initialQuantity > 0) {
      // Find a system user or admin for the entry (need to be careful here)
      const user = await prisma.user.findFirst({ where: { role: "admin" } });
      if (user) {
        await prisma.inventoryLedger.create({
          data: {
            inventoryItemId: newItem.id,
            deltaQuantity: initialQuantity,
            reason: "manual",
            warehouseId,
            createdById: user.id,
            note: "Initial sync from Excel"
          }
        });
      }
    }
    
    count++;
  }

  console.log(`\n✅ Finished. Total items synced: ${count}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
