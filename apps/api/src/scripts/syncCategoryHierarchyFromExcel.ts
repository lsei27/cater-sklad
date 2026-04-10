import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";
import { normalizeMainCategory, normalizeChildCategory } from "./categoryNormalize.js";

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

function loadExcelRows(): ExcelRow[] {
  const pythonPath = path.join(repoRoot, ".venv", "bin", "python3");
  const parserPath = path.join(__dirname, "parse_excel.py");
  const excelPath = path.join(repoRoot, "Sklad_new.xlsx");
  const output = execFileSync(pythonPath, [parserPath, excelPath], { encoding: "utf8" });
  return JSON.parse(output) as ExcelRow[];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = loadExcelRows()
    .map((row) => ({
      name: String(row.name ?? "").trim(),
      sku: (String(row.sku ?? "").trim() || null),
      mainCategory: normalizeMainCategory(row.main_category ?? row.parent_category),
      childCategory: normalizeChildCategory(row.child_category ?? row.category)
    }))
    .filter((row) => row.name && row.mainCategory);

  // Build canonical order by first appearance in Excel.
  const mainOrder = new Map<string, number>();
  const childOrderByMain = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!mainOrder.has(row.mainCategory)) {
      mainOrder.set(row.mainCategory, mainOrder.size + 1);
    }
    if (!row.childCategory) continue;
    if (!childOrderByMain.has(row.mainCategory)) {
      childOrderByMain.set(row.mainCategory, new Map<string, number>());
    }
    const childOrder = childOrderByMain.get(row.mainCategory)!;
    if (!childOrder.has(row.childCategory)) {
      childOrder.set(row.childCategory, childOrder.size + 1);
    }
  }

  const report = {
    dryRun,
    mainCategories: mainOrder.size,
    childCategories: Array.from(childOrderByMain.values()).reduce((sum, map) => sum + map.size, 0),
    updatedItems: 0,
    unchangedItems: 0,
    missingItems: [] as Array<{ sku: string | null; name: string }>,
    ambiguousItems: [] as Array<{ sku: string | null; name: string; matches: number }>,
    deletedCategories: [] as string[]
  };

  await prisma.$transaction(
    async (tx) => {
      // 1. Ensure canonical main categories exist with desired name + sortOrder.
      //    If the exact canonical name already exists at root — reuse it.
      //    Otherwise try case-insensitive match against an existing root; if that matches a
      //    typo-variant, rename it to the canonical form.
      const mainCategoryIds = new Map<string, string>();
      for (const [mainName, sortOrder] of mainOrder) {
        let existing = await tx.category.findFirst({
          where: { parentId: null, name: mainName }
        });
        if (!existing) {
          existing = await tx.category.findFirst({
            where: { parentId: null, name: { equals: mainName, mode: "insensitive" } }
          });
        }
        if (existing) {
          if (existing.name !== mainName || existing.sortOrder !== sortOrder) {
            existing = await tx.category.update({
              where: { id: existing.id },
              data: { name: mainName, sortOrder }
            });
          }
        } else {
          existing = await tx.category.create({
            data: { parentId: null, name: mainName, sortOrder }
          });
        }
        mainCategoryIds.set(mainName, existing.id);
      }

      // 2. Ensure child categories exist under canonical parents.
      const childCategoryIds = new Map<string, string>();
      for (const [mainName, childOrder] of childOrderByMain) {
        const parentId = mainCategoryIds.get(mainName)!;
        for (const [childName, childSortOrder] of childOrder) {
          let existing = await tx.category.findFirst({
            where: { parentId, name: childName }
          });
          if (!existing) {
            existing = await tx.category.findFirst({
              where: { parentId, name: { equals: childName, mode: "insensitive" } }
            });
          }
          if (existing) {
            if (existing.name !== childName || existing.sortOrder !== childSortOrder) {
              existing = await tx.category.update({
                where: { id: existing.id },
                data: { name: childName, sortOrder: childSortOrder }
              });
            }
          } else {
            existing = await tx.category.create({
              data: { parentId, name: childName, sortOrder: childSortOrder }
            });
          }
          childCategoryIds.set(`${mainName}::${childName}`, existing.id);
        }
      }

      // 3. Reassign every Excel item to its canonical (main|child) category.
      for (const row of rows) {
        const desiredCategoryId = row.childCategory
          ? childCategoryIds.get(`${row.mainCategory}::${row.childCategory}`)
          : mainCategoryIds.get(row.mainCategory);

        if (!desiredCategoryId) continue;

        // Match by SKU first, but only if the name also matches (Excel can have duplicate
        // SKUs that the original import suffixed with -1/-2, making SKU lookup ambiguous).
        let item = row.sku
          ? await tx.inventoryItem.findFirst({
              where: { sku: row.sku, name: { equals: row.name, mode: "insensitive" } }
            })
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

      // 4. Delete orphan categories: anything that is not in the canonical set
      //    and no longer owns items. Delete children first so parents become empty.
      const canonicalIds = new Set<string>([
        ...mainCategoryIds.values(),
        ...childCategoryIds.values()
      ]);

      if (!dryRun) {
        // Delete leafs (categories with no children) that are non-canonical and have no items.
        // Loop until nothing more can be deleted.
        // This also rescues grand-children by gradually pruning the tree.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const deletable = await tx.category.findMany({
            where: {
              id: { notIn: Array.from(canonicalIds) },
              items: { none: {} },
              children: { none: {} }
            },
            select: { id: true, name: true, parentId: true }
          });
          if (deletable.length === 0) break;
          for (const cat of deletable) {
            await tx.category.delete({ where: { id: cat.id } });
            report.deletedCategories.push(cat.name);
          }
        }
      }
    },
    { maxWait: 60_000, timeout: 180_000 }
  );

  console.log(JSON.stringify(report, null, 2));
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
