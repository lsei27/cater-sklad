import { LedgerReason, PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";
import { execSync } from "node:child_process";
import path from "node:path";
import { normalizeMainCategory, normalizeChildCategory } from "./categoryNormalize.js";

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function slugify(text: string) {
  return text
    .toString()
    .normalize('NFD')                   // split accented characters into their base characters and diacritical marks
    .replace(/[\u0300-\u036f]/g, '')   // remove all the accents, which happen to be all in the \u03xx UNICODE block.
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')              // replace spaces with -
    .replace(/[^\w-]+/g, '')           // remove all non-word chars
    .replace(/--+/g, '-');             // replace multiple - with single -
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  
  console.log("Reading Excel Data...");
  const pythonPath = "../../.venv/bin/python3"; 
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
    // The order of deletion is important due to foreign key constraints
    await prisma.eventReservation.deleteMany();
    await prisma.inventoryLedger.deleteMany();
    await prisma.eventIssue.deleteMany();
    await prisma.eventReturn.deleteMany();
    await prisma.warehouseBlock.deleteMany();
    await prisma.warehouseTransfer.deleteMany();
    await prisma.crossSellLink.deleteMany();
    await prisma.inventoryItem.deleteMany();
    await prisma.roleCategoryAccess.deleteMany();
    await prisma.category.deleteMany();
    console.log("✅ Database cleaned (including categories).");
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

  // Helper to find or create category by name (case-insensitive)
  const categoryMap = new Map<string, string>(); // slug -> id

  async function getOrCreateCategory(name: string, parentId: string | null = null): Promise<string> {
    const trimmedName = name.trim();
    const slug = `${parentId || "root"}:${trimmedName.toLowerCase()}`;
    
    if (categoryMap.has(slug)) return categoryMap.get(slug)!;

    let cat = await prisma.category.findFirst({
      where: { 
        name: { equals: trimmedName, mode: 'insensitive' },
        parentId: parentId || null
      }
    });

    if (!cat) {
      if (isDryRun) {
        return "temp-id";
      }
      cat = await prisma.category.create({
        data: { name: trimmedName, parentId: parentId || null }
      });
    }

    categoryMap.set(slug, cat.id);
    return cat.id;
  }

  console.log("🚀 Syncing items...");
  let count = 0;
  const skuToId = new Map<string, string>();

  for (const item of data) {
    const name = item.name?.trim();
    if (!name) continue;

    const catName = normalizeChildCategory(item.child_category || item.category);
    const parentCatName = normalizeMainCategory(item.main_category || item.parent_category) || "Ostatní";
    const sku = item.sku ? String(item.sku).trim() : null;
    const unit = item.unit || "ks";
    const masterPackageQty = item["master package"] ? parseInt(String(item["master package"])) : null;
    const masterPackageWeight = item["master package weight"];
    const initialQuantity = item.quantity ? parseInt(String(item.quantity)) : 0;
    
    // Auto-image URL from name
    const imageUrl = `bunny://${slugify(name)}.jpg`;

    if (isDryRun) {
      console.log(` - Would add item: ${name} (SKU: ${sku}, Category: ${catName})`);
      count++;
      continue;
    }

    // 1. Resolve Categories
    let categoryId: string;
    if (catName) {
      const parentId = await getOrCreateCategory(parentCatName, null);
      categoryId = await getOrCreateCategory(catName, parentId);
    } else {
      categoryId = await getOrCreateCategory(parentCatName, null);
    }

    // 2. Create Item
    let finalSku = sku;
    if (sku) {
      if (skuToId.has(sku)) {
        let suffix = 1;
        while (skuToId.has(`${sku}-${suffix}`)) {
          suffix++;
        }
        finalSku = `${sku}-${suffix}`;
        console.log(`⚠️ Duplicate SKU detected: ${sku}. Using ${finalSku} for ${name}.`);
      }
    }

    const newItem = await prisma.inventoryItem.create({
      data: {
        name,
        sku: finalSku || undefined,
        unit,
        categoryId,
        warehouseId,
        imageUrl,
        masterPackageQty,
        masterPackageWeight: masterPackageWeight ? String(masterPackageWeight) : null,
      }
    });

    if (finalSku) skuToId.set(finalSku, newItem.id);
    if (sku && finalSku !== sku) {
       // Also track the original sku in a way we can still map cross-sells if they use original
       // But cross-sell mapping usually uses the EXACT sku.
    }

    // 3. Initial stock entry
    if (initialQuantity > 0) {
      const user = await prisma.user.findFirst({ where: { role: "admin" } });
      if (user) {
        await prisma.inventoryLedger.create({
          data: {
            inventoryItemId: newItem.id,
            deltaQuantity: initialQuantity,
            reason: LedgerReason.manual,
            warehouseId,
            createdById: user.id,
            note: "Initial sync from Excel"
          }
        });
      }
    }
    
    count++;
  }

  // 4. Link Cross Sells
  if (!isDryRun) {
    console.log("🔗 Linking cross-sells...");
    for (const item of data) {
      const sourceSku = item.sku ? String(item.sku).trim() : null;
      if (!sourceSku || !skuToId.has(sourceSku)) continue;

      const sourceId = skuToId.get(sourceSku)!;
      
      // Check 10 columns for cross-sells
      for (let i = 1; i <= 10; i++) {
        const targetSku = item[`Cross sell ${i}`] || item[`Cross sel ${i}`];
        if (targetSku && skuToId.has(String(targetSku).trim())) {
          const targetId = skuToId.get(String(targetSku).trim())!;
          await prisma.crossSellLink.upsert({
            where: {
              sourceItemId_targetItemId: {
                sourceItemId: sourceId,
                targetItemId: targetId
              }
            },
            create: {
              sourceItemId: sourceId,
              targetItemId: targetId
            },
            update: {}
          });
        }
      }
    }
  }

  console.log(`\n✅ Finished. Total items synced: ${count}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
