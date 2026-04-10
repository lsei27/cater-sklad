import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");
const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type ExcelRow = {
  name?: string | null;
  sku?: string | null;
  main_category?: string | null;
  child_category?: string | null;
  parent_category?: string | null;
  category?: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function loadExcelRows(): ExcelRow[] {
  const pythonPath = path.join(repoRoot, ".venv", "bin", "python3");
  const parserPath = path.join(__dirname, "parse_excel.py");
  const excelPath = path.join(repoRoot, "Sklad_new.xlsx");
  const output = execFileSync(pythonPath, [parserPath, excelPath], { encoding: "utf8" });
  return JSON.parse(output) as ExcelRow[];
}

async function getOrCreateCategory(params: {
  tx: any;
  parentId: string | null;
  name: string;
  sortOrder: number;
}) {
  const { tx, parentId, name, sortOrder } = params;
  const existing = await tx.category.findFirst({
    where: {
      parentId,
      name: { equals: name, mode: "insensitive" }
    }
  });
  if (existing) {
    if (existing.sortOrder !== sortOrder || existing.name !== name) {
      return tx.category.update({
        where: { id: existing.id },
        data: { name, sortOrder }
      });
    }
    return existing;
  }
  return tx.category.create({ data: { parentId, name, sortOrder } });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = loadExcelRows()
    .map((row) => ({
      name: normalize(row.name),
      sku: normalize(row.sku) || null,
      mainCategory: normalize(row.main_category ?? row.parent_category),
      childCategory: normalize(row.child_category ?? row.category)
    }))
    .filter((row) => row.name && row.mainCategory);

  const mainOrder = new Map<string, number>();
  const childOrderByMain = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!mainOrder.has(row.mainCategory)) {
      mainOrder.set(row.mainCategory, mainOrder.size + 1);
    }
    if (!row.childCategory) continue;
    const childOrder = childOrderByMain.get(row.mainCategory) ?? new Map<string, number>();
    if (!childOrderByMain.has(row.mainCategory)) childOrderByMain.set(row.mainCategory, childOrder);
    if (!childOrder.has(row.childCategory)) {
      childOrder.set(row.childCategory, childOrder.size + 1);
    }
  }

  const report = {
    mainCategories: mainOrder.size,
    childCategories: Array.from(childOrderByMain.values()).reduce((sum, map) => sum + map.size, 0),
    updatedItems: 0,
    unchangedItems: 0,
    missingItems: [] as Array<{ sku: string | null; name: string }>,
    ambiguousItems: [] as Array<{ sku: string | null; name: string; matches: number }>
  };

  await prisma.$transaction(async (tx) => {
    const mainCategoryIds = new Map<string, string>();
    const childCategoryIds = new Map<string, string>();

    for (const [mainName, sortOrder] of mainOrder) {
      const mainCategory = await getOrCreateCategory({ tx, parentId: null, name: mainName, sortOrder });
      mainCategoryIds.set(mainName, mainCategory.id);

      const childOrder = childOrderByMain.get(mainName);
      if (!childOrder) continue;
      for (const [childName, childSortOrder] of childOrder) {
        const childCategory = await getOrCreateCategory({
          tx,
          parentId: mainCategory.id,
          name: childName,
          sortOrder: childSortOrder
        });
        childCategoryIds.set(`${mainName}::${childName}`, childCategory.id);
      }
    }

    for (const row of rows) {
      const desiredCategoryId = row.childCategory
        ? childCategoryIds.get(`${row.mainCategory}::${row.childCategory}`)
        : mainCategoryIds.get(row.mainCategory);

      if (!desiredCategoryId) continue;

      let item = row.sku
        ? await tx.inventoryItem.findUnique({ where: { sku: row.sku } })
        : null;

      if (!item) {
        const matches = await tx.inventoryItem.findMany({
          where: { name: { equals: row.name, mode: "insensitive" } },
          select: { id: true, categoryId: true }
        });
        if (matches.length === 0) {
          report.missingItems.push({ sku: row.sku, name: row.name });
          continue;
        }
        if (matches.length > 1) {
          report.ambiguousItems.push({ sku: row.sku, name: row.name, matches: matches.length });
          continue;
        }
        item = await tx.inventoryItem.findUnique({ where: { id: matches[0]!.id } });
      }

      if (!item) {
        report.missingItems.push({ sku: row.sku, name: row.name });
        continue;
      }

      if (item.categoryId === desiredCategoryId) {
        report.unchangedItems += 1;
        continue;
      }

      report.updatedItems += 1;
      if (!dryRun) {
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { categoryId: desiredCategoryId }
        });
      }
    }
  }, { maxWait: 60_000, timeout: 120_000 });

  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
