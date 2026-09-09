// Sync katalogu inventare z Excelu. Paruje polozky pres SKU (u polozek bez SKU
// pres jmeno v ramci kategorie), stejne jako CSV import v routes/admin.ts.
//
// NEMAZE. Driv smazal cely inventar a zalozil ho znovu s novymi UUID, cimz
// zahodil rezervace, ledger, vydeje i vratky - a snapshoty v event_exports
// pak ukazovaly na neexistujici polozky (viz "Nejdou vyskladnit nektere akce").
//
// Pousteni z apps/api (kvuli .env, stejne jako prisma):
//   tsx src/scripts/syncFromExcel.ts                    nanecisto (vychozi)
//   tsx src/scripts/syncFromExcel.ts --apply            ostre, jen lokalni DB
//   tsx src/scripts/syncFromExcel.ts --apply --allow-remote-write=<host>
//                                                       ostre na vzdalenou DB
//
// Volitelne:
//   --sync-quantities      srovna i mnozstvi podle Excelu (jinak se stav
//                          skladu nechava byt - Excel byva zastaraly)
//   --deactivate-missing   polozky, ktere v Excelu nejsou, prepne na neaktivni
//                          (nikdy nemaze, aby nezmizela historie)
import { LedgerReason, PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";
import { execSync } from "node:child_process";
import path from "node:path";
import { normalizeMainCategory, normalizeChildCategory } from "./categoryNormalize.js";
import { decideSyncExecution } from "../lib/syncGuard.js";
import { createInventoryLedgerEntry } from "../services/ledger.js";
import { getPhysicalTotal } from "../services/availability.js";
import { fileURLToPath } from "node:url";

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
  // Nanecisto je vychozi stav. Ostry beh se musi vyzadat a na vzdalene databazi
  // navic potvrdit vypsanim hostitele - viz src/lib/syncGuard.ts.
  const decision = decideSyncExecution({
    databaseUrl: env.DATABASE_URL,
    argv: process.argv.slice(2)
  });
  const isDryRun = !decision.apply;

  console.log(`Cíl: ${decision.database} @ ${decision.host}${decision.isLocal ? " (lokální)" : " (VZDÁLENÁ)"}`);
  if (isDryRun) {
    console.log(`⚠️  NANEČISTO: ${decision.reason}`);
    console.log("    Nic se nesmaže ani nezapíše.");
  } else {
    console.log("✍️  OSTRÝ BĚH: zapisuje se do katalogu. Historie ani stav skladu se nemažou.");
  }

  console.log("Reading Excel Data...");
  // Cesty k Pythonu a k Excelu se odvozuji od umisteni skriptu. Driv ukazovaly
  // na ".venv" (v repu je "venv"), takze parsovani padalo vzdycky.
  // Pozn.: .env se stejne jako u prisma cte z aktualniho adresare, takze
  // skript se pousti z apps/api.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "../../../..");
  const pythonPath = path.join(repoRoot, "venv/bin/python3");
  const scriptPath = path.join(here, "parse_excel.py");
  const excelPath = path.join(repoRoot, "Sklad_new.xlsx");
  
  let data: any[];
  try {
    const output = execSync(`"${pythonPath}" "${scriptPath}" "${excelPath}"`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    data = JSON.parse(output);
  } catch (err) {
    console.error("❌ Failed to parse Excel:", err);
    process.exit(1);
  }

  console.log(`📦 Found ${data.length} items in Excel.`);

  const syncQuantities = process.argv.includes("--sync-quantities");
  const deactivateMissing = process.argv.includes("--deactivate-missing");

  if (isDryRun) {
    console.log("⚠️ DRY RUN: No changes will be applied.");
  } else {
    console.log(
      syncQuantities
        ? "📦 Množství se srovná podle Excelu (--sync-quantities)."
        : "📦 Množství se nemění. Pro srovnání podle Excelu přidej --sync-quantities."
    );
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
  let created = 0;
  let updated = 0;
  let ledgerAdjustments = 0;
  const skuToId = new Map<string, string>();
  const seenItemIds = new Set<string>();
  const adminUserId = isDryRun
    ? null
    : (await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } }))?.id ?? null;

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

    // 1. Resolve Categories
    let categoryId: string;
    if (catName) {
      const parentId = await getOrCreateCategory(parentCatName, null);
      categoryId = await getOrCreateCategory(catName, parentId);
    } else {
      categoryId = await getOrCreateCategory(parentCatName, null);
    }

    // 2. Naparovat existujici polozku - pres SKU, jinak pres jmeno v kategorii.
    //    Stejny klic jako CSV import v routes/admin.ts.
    // "temp-id" znaci kategorii, ktera by se teprve zalozila (nanecisto),
    // takze v ni jeste zadna polozka byt nemuze.
    const byName = async () =>
      categoryId === "temp-id"
        ? null
        : await prisma.inventoryItem.findFirst({ where: { name, categoryId } });

    let existing = sku ? await prisma.inventoryItem.findUnique({ where: { sku } }) : await byName();

    // Polozka zalozena rucne v aplikaci SKU nema. Kdyby se hledalo jen pres nej,
    // sync by ji zalozil podruhe - proto se u nenalezeneho SKU jeste zkusi jmeno
    // a SKU se na tu existujici polozku doplni.
    let adoptedSku = false;
    if (sku && !existing) {
      const sameName = await byName();
      if (sameName && !sameName.sku) {
        existing = sameName;
        adoptedSku = true;
      }
    }

    if (isDryRun) {
      console.log(
        existing
          ? ` ~ aktualizoval by: ${name}${sku ? ` (${sku})` : ""}` +
            (adoptedSku ? " [napárováno podle jména, doplnilo by SKU]" : "")
          : ` + založil by: ${name}${sku ? ` (${sku})` : ""} → ${catName || parentCatName}`
      );
      if (existing) { updated++; seenItemIds.add(existing.id); } else created++;
      count++;
      continue;
    }

    const itemData = {
      name,
      unit,
      categoryId,
      imageUrl,
      masterPackageQty,
      masterPackageWeight: masterPackageWeight ? String(masterPackageWeight) : null,
      // Sklad se nastavuje jen pri zalozeni. Prepsat ho pri kazdem syncu by
      // zahodilo rucni presuny mezi sklady.
      ...(existing ? {} : { warehouseId }),
      ...(adoptedSku && sku ? { sku } : {})
    };

    const dbItem = existing
      ? await prisma.inventoryItem.update({ where: { id: existing.id }, data: itemData })
      : await prisma.inventoryItem.create({ data: { ...itemData, sku: sku || undefined } });

    if (existing) updated++; else created++;
    seenItemIds.add(dbItem.id);
    if (dbItem.sku) skuToId.set(dbItem.sku, dbItem.id);

    // 3. Mnozstvi - jen kdyz o to nekdo vyslovne rekne, nebo u nove polozky.
    //    Excel byva zastaraly a slepe srovnani by prepsalo skutecny stav skladu.
    if (initialQuantity > 0 || syncQuantities) {
      const shouldTouch = !existing || syncQuantities;
      if (shouldTouch) {
        const current = existing ? await getPhysicalTotal(prisma, dbItem.id) : 0;
        const delta = initialQuantity - current;
        if (delta !== 0) {
          if (!adminUserId) {
            console.log(`⚠️  Přeskakuji množství u "${name}" - v databázi není žádný admin.`);
          } else {
            await createInventoryLedgerEntry(prisma, {
              inventoryItemId: dbItem.id,
              deltaQuantity: delta,
              reason: existing ? LedgerReason.audit_adjustment : LedgerReason.manual,
              warehouseId: dbItem.warehouseId ?? warehouseId ?? null,
              createdById: adminUserId,
              note: `Sync z Excelu: quantity=${initialQuantity} (bylo ${current})`
            });
            ledgerAdjustments++;
          }
        }
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

  // Polozky, ktere v Excelu nejsou. NIKDY se nemazou - smazanim by zmizely
  // rezervace a historie a snapshoty exportu by ukazovaly do prazdna.
  if (!isDryRun) {
    const orphans = await prisma.inventoryItem.findMany({
      where: { id: { notIn: Array.from(seenItemIds) }, active: true },
      select: { id: true, name: true, sku: true }
    });
    if (orphans.length > 0) {
      console.log(`\n⚠️  ${orphans.length} aktivních položek není v Excelu:`);
      for (const o of orphans.slice(0, 20)) {
        console.log(`   - ${o.name}${o.sku ? ` (${o.sku})` : ""}`);
      }
      if (orphans.length > 20) console.log(`   - a dalších ${orphans.length - 20}`);

      if (deactivateMissing) {
        await prisma.inventoryItem.updateMany({
          where: { id: { in: orphans.map((o) => o.id) } },
          data: { active: false }
        });
        console.log(`   → přepnuto na neaktivní (--deactivate-missing). Data zůstala.`);
      } else {
        console.log("   → ponechány beze změny. Pro deaktivaci přidej --deactivate-missing.");
      }
    }
  }

  console.log(
    `\n✅ Hotovo. Zpracováno ${count} řádků: ${created} nových, ${updated} aktualizovaných, ` +
    `${ledgerAdjustments} úprav skladu.`
  );
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
