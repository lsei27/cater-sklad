# Skladník doplňuje položky do cizí akce — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skladník může přidávat položky do akce založené event managerem, a to jak před výdejem, tak u už vydané akce formou doplňkového výdeje.

**Architecture:** Před výdejem jde jen o odblokování UI, backend skladníka už pouští. U vydané akce přibude endpoint `POST /events/:id/issue-additional`, který zapíše další řádek do `event_issues`, odepíše zboží z ledgeru a přepočítá váhu akce z celého výdeje. Výpočet váhy a sestavení seznamu vydaných položek se vytáhnou ze `events.ts` do samostatných služeb, aby je mohly sdílet oba výdejové endpointy.

**Tech Stack:** Fastify + Prisma 7 (driver adapter `@prisma/adapter-pg`), PostgreSQL, React 19 + Vite, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-skladnik-doplneni-akce-design.md`
- Commit messages: rozkazovací způsob, česky, **bez diakritiky** a bez dlouhé pomlčky. Zakončit `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Necommitovat rozpracované `.gitignore`, `Sklad_new.xlsx`, `aktualni_sklad_doplneno.csv`, `obrazky_webp/`, `requirements.txt`. Ty jsou v pracovním stromu z dřívějška.
- Nikdy nepoužívat `type: any` v nově psaném TypeScriptu. Stávající `any` v okolním kódu neopravovat.
- Integrační testy běží jen s `RUN_DB_TESTS=1` a `DATABASE_URL` na testovací databázi. Testovací databáze se zakládá takto:

```bash
docker compose up -d db
docker exec cater_sklad-db-1 psql -U cater -d postgres -c "DROP DATABASE IF EXISTS cater_test;" -c "CREATE DATABASE cater_test;"
export DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_test?schema=public"
pnpm --filter @cater-sklad/api exec prisma db push
```

Spouštění testů:

```bash
export DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_test?schema=public"
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api test
```

- Prisma klient v testech se vytváří přes `createTestPrisma(url)` z `apps/api/test/testPrisma.ts`. Konstruktor `new PrismaClient({ datasources: ... })` v Prisma 7 nefunguje.
- Pracovní větev: `feat/skladnik-doplneni-akce` (už existuje, obsahuje spec).

---

## File Structure

| Soubor | Zodpovědnost |
|---|---|
| `apps/api/src/services/issuedItems.ts` | **Nový.** Sestaví seznam skutečně vydaných položek akce z `event_issues`. |
| `apps/api/src/services/issueWeight.ts` | **Nový.** Parsování a formátování váhy + přepočet celkové váhy akce z celého výdeje. |
| `apps/api/src/services/issueAdditional.ts` | **Nový.** Transakce doplňkového výdeje. |
| `apps/api/src/routes/events.ts` | Napojení nových služeb, nový endpoint. |
| `apps/web/src/components/AdditionalIssueModal.tsx` | **Nový.** Výběr položek pro doplňkový výdej. |
| `apps/web/src/pages/EventDetailPage.tsx` | Odblokování skladníka u cizí akce. |
| `apps/web/src/pages/WarehouseEventDetailPage.tsx` | Tlačítko „Vydat navíc" a napojení modalu. |
| `apps/api/test/issuedItems.integration.test.ts` | **Nový.** |
| `apps/api/test/issueWeight.integration.test.ts` | **Nový.** |
| `apps/api/test/issueAdditional.integration.test.ts` | **Nový.** |

---

## Task 1: Seznam vydaných položek jako služba

Dnes je dotaz na vydané položky vložený přímo v routě jako záložní větev a **je rozbitý**: joinuje tabulku `inventory_categories`, která neexistuje. Schéma mapuje kategorie na `categories` (`schema.prisma:77`). Větev se pouští jen u vydané akce s prázdným exportem, proto si toho nikdo nevšiml. Task ho opraví, vytáhne do služby a udělá z něj hlavní zdroj pro stav `ISSUED`.

**Files:**
- Create: `apps/api/src/services/issuedItems.ts`
- Create: `apps/api/test/issuedItems.integration.test.ts`
- Modify: `apps/api/src/routes/events.ts:286-322`

**Interfaces:**
- Produces: `getIssuedWarehouseItems(prisma, eventId): Promise<IssuedWarehouseItem[]>` kde
  `IssuedWarehouseItem = { inventoryItemId: string; name: string; unit: string; qty: number; parentCategory: string; category: string }`

- [ ] **Step 1: Napiš padající test**

Vytvoř `apps/api/test/issuedItems.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Role, LedgerReason, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { getIssuedWarehouseItems } from "../src/services/issuedItems.js";

describe("seznam vydanych polozek (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("secte vice radku vydeje na jednu polozku a doplni kategorie", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `issued-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `Inventar-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Sklo-${stamp}`, parentId: parent.id } });
    const item = await prisma.inventoryItem.create({
      data: { name: `Sklenice-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
    });

    const event = await prisma.event.create({
      data: {
        name: `Akce-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    for (const [suffix, qty] of [["a", 10], ["b", 4]] as const) {
      await prisma.eventIssue.create({
        data: {
          eventId: event.id,
          inventoryItemId: item.id,
          issuedQuantity: qty,
          type: "issued",
          warehouseId: warehouse.id,
          issuedById: user.id,
          idempotencyKey: `iss-${suffix}:${event.id}:${item.id}`
        }
      });
    }

    // Ztraty se do seznamu nesmi pocitat.
    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 3,
        type: "missing",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `miss:${event.id}:${item.id}`
      }
    });

    const rows = await getIssuedWarehouseItems(prisma, event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inventoryItemId: item.id,
      name: `Sklenice-${stamp}`,
      unit: "ks",
      qty: 14,
      parentCategory: `Inventar-${stamp}`,
      category: `Sklo-${stamp}`
    });

    await disconnect();
  });

  maybe("polozka bez nadrazene kategorie ma prazdnou podkategorii", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `issued2-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad2-${stamp}` } });
    const solo = await prisma.category.create({ data: { name: `Samostatna-${stamp}` } });
    const item = await prisma.inventoryItem.create({
      data: { name: `Bedna-${stamp}`, categoryId: solo.id, unit: "ks", warehouseId: warehouse.id }
    });
    const event = await prisma.event.create({
      data: {
        name: `Akce2-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });
    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 2,
        type: "issued",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `solo:${event.id}:${item.id}`
      }
    });

    const rows = await getIssuedWarehouseItems(prisma, event.id);
    expect(rows[0]?.parentCategory).toBe(`Samostatna-${stamp}`);
    expect(rows[0]?.category).toBe("");

    await disconnect();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

```bash
export DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_test?schema=public"
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api exec vitest run test/issuedItems.integration.test.ts
```

Očekávaný výsledek: FAIL, `Cannot find module '../src/services/issuedItems.js'`.

- [ ] **Step 3: Napiš službu**

Vytvoř `apps/api/src/services/issuedItems.ts`:

```ts
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

export type IssuedWarehouseItem = {
  inventoryItemId: string;
  name: string;
  unit: string;
  qty: number;
  parentCategory: string;
  category: string;
};

type IssuedRow = {
  inventory_item_id: string;
  issued: number;
  name: string;
  unit: string;
  parent_category: string;
  category: string;
};

/**
 * Skutečně vydané položky akce, sečtené přes všechny řádky výdeje.
 * U vydané akce je tohle pravda o obsahu, ne export: doplňkový výdej
 * přidává další řádky, které v exportu nejsou.
 */
export async function getIssuedWarehouseItems(
  prisma: PrismaClient | Prisma.TransactionClient,
  eventId: string
): Promise<IssuedWarehouseItem[]> {
  const rows = await prisma.$queryRaw<IssuedRow[]>`
    SELECT
      i.inventory_item_id::text AS inventory_item_id,
      COALESCE(SUM(i.issued_quantity), 0)::int AS issued,
      it.name AS name,
      it.unit AS unit,
      COALESCE(cp.name, c.name, 'Nezařazeno') AS parent_category,
      CASE WHEN cp.id IS NULL THEN '' ELSE COALESCE(c.name, '') END AS category
    FROM event_issues i
    JOIN inventory_items it ON it.id = i.inventory_item_id
    LEFT JOIN categories c ON c.id = it.category_id
    LEFT JOIN categories cp ON cp.id = c.parent_id
    WHERE i.event_id = ${eventId}::uuid AND i.type = 'issued'
    GROUP BY i.inventory_item_id, it.name, it.unit, cp.id, cp.name, c.name
    ORDER BY it.name
  `;

  return rows.map((r) => ({
    inventoryItemId: r.inventory_item_id,
    name: r.name,
    unit: r.unit,
    qty: Number(r.issued),
    parentCategory: r.parent_category,
    category: r.category
  }));
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

```bash
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api exec vitest run test/issuedItems.integration.test.ts
```

Očekávaný výsledek: PASS, 2 testy.

- [ ] **Step 5: Napoj službu do routy**

V `apps/api/src/routes/events.ts` přidej import k ostatním importům služeb (u ř. 8):

```ts
import { getIssuedWarehouseItems } from "../services/issuedItems.js";
```

Pak nahraď celý blok od `let warehouseItems` po konec záložní větve (ř. 286-322) tímto:

```ts
    let warehouseItems: Array<{
      inventoryItemId: string;
      name: string;
      unit: string;
      qty: number;
      parentCategory?: string;
      category?: string;
    }> = [];

    // U vydané akce je pravdou o obsahu skutečný výdej, ne export: doplňkový
    // výdej přidává položky, které v exportu nejsou.
    if (event.status === "ISSUED") {
      warehouseItems = await getIssuedWarehouseItems(app.prisma, event.id);
    }

    const snapshot = (exports?.[0] as any)?.snapshotJson as ExportSnapshot | undefined;
    if (warehouseItems.length === 0 && snapshot?.groups?.length) {
      warehouseItems = snapshot.groups.flatMap((g) =>
        (g.items ?? []).map((it) => ({
          inventoryItemId: it.inventoryItemId,
          name: it.name,
          unit: it.unit,
          qty: it.qty,
          parentCategory: g.parentCategory,
          category: (g as { category?: string }).category
        }))
      );
    }
```

- [ ] **Step 6: Ověř, že nic jiného nespadlo**

```bash
pnpm --filter @cater-sklad/api exec tsc -p tsconfig.json --noEmit
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api test
```

Očekávaný výsledek: typecheck bez chyb, všechny testy zelené.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/issuedItems.ts apps/api/test/issuedItems.integration.test.ts apps/api/src/routes/events.ts
git commit -m "$(cat <<'EOF'
Oprav a osamostatni seznam vydanych polozek akce

Dotaz joinoval tabulku inventory_categories, ktera neexistuje, schema
mapuje kategorie na categories. Vetev se poustela jen u vydane akce
s prazdnym exportem, proto si toho nikdo nevsiml.

U vydane akce je nove seznam polozek stavieny z event_issues, protoze
doplnkovy vydej pridava polozky, ktere v exportu nejsou.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Přepočet váhy akce jako sdílená služba

Výpočet váhy je dnes zadrátovaný uvnitř `/events/:id/issue` a počítá se z položek jedné dávky. Doplňkový výdej potřebuje počítat z celé akce, jinak se rozejde zaokrouhlování na celá master balení.

**Files:**
- Create: `apps/api/src/services/issueWeight.ts`
- Create: `apps/api/test/issueWeight.integration.test.ts`
- Modify: `apps/api/src/routes/events.ts` — odstranit lokální `parseWeightValue` a `formatWeightKg` nad `EventCreateSchema`, použít službu v handleru `app.post("/events/:id/issue", ...)`. Čísla řádků neuvádím schválně, Task 1 už soubor posunul.

**Interfaces:**
- Consumes: nic z předchozích tasků.
- Produces:
  - `parseWeightValue(value: string | null | undefined): number | null`
  - `formatWeightKg(value: number): string`
  - `computeIssuedWeightKg(tx: Prisma.TransactionClient, eventId: string): Promise<number>`

- [ ] **Step 1: Napiš padající test**

Vytvoř `apps/api/test/issueWeight.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Role, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { computeIssuedWeightKg, formatWeightKg, parseWeightValue } from "../src/services/issueWeight.js";

describe("prepocet vahy vydeje", () => {
  it("parsuje desetinnou carku i tecku", () => {
    expect(parseWeightValue("8,5")).toBe(8.5);
    expect(parseWeightValue("8.5")).toBe(8.5);
    expect(parseWeightValue("12 kg")).toBe(12);
    expect(parseWeightValue("")).toBeNull();
    expect(parseWeightValue(null)).toBeNull();
  });

  it("formatuje kilogramy cesky", () => {
    expect(formatWeightKg(17)).toBe("17 kg");
    expect(formatWeightKg(8.5)).toBe("8,5 kg");
  });

  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("pocita baleni ze souctu mnozstvi, ne po davkach", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `weight-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `SkladW-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `InventarW-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `SkloW-${stamp}`, parentId: parent.id } });
    // Baleni po 10 kusech, jedno baleni vazi 8.5 kg.
    const item = await prisma.inventoryItem.create({
      data: {
        name: `TalirW-${stamp}`,
        categoryId: child.id,
        unit: "ks",
        warehouseId: warehouse.id,
        masterPackageQty: 10,
        masterPackageWeight: "8.5"
      }
    });
    const event = await prisma.event.create({
      data: {
        name: `AkceW-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    // Dve davky: 6 a 3 kusy. Po davkach by to bylo 1+1 = 2 baleni (17 kg),
    // ze souctu 9 kusu vyjde 1 baleni (8,5 kg).
    for (const [suffix, qty] of [["a", 6], ["b", 3]] as const) {
      await prisma.eventIssue.create({
        data: {
          eventId: event.id,
          inventoryItemId: item.id,
          issuedQuantity: qty,
          type: "issued",
          warehouseId: warehouse.id,
          issuedById: user.id,
          idempotencyKey: `w-${suffix}:${event.id}:${item.id}`
        }
      });
    }

    const kg = await prisma.$transaction((tx) => computeIssuedWeightKg(tx, event.id));
    expect(kg).toBe(8.5);

    await disconnect();
  });

  maybe("polozka bez udaju o baleni do vahy neprispiva", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `weight2-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `SkladW2-${stamp}` } });
    const cat = await prisma.category.create({ data: { name: `KatW2-${stamp}` } });
    const item = await prisma.inventoryItem.create({
      data: { name: `BezBaleni-${stamp}`, categoryId: cat.id, unit: "ks", warehouseId: warehouse.id }
    });
    const event = await prisma.event.create({
      data: {
        name: `AkceW2-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });
    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 5,
        type: "issued",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `w2:${event.id}:${item.id}`
      }
    });

    const kg = await prisma.$transaction((tx) => computeIssuedWeightKg(tx, event.id));
    expect(kg).toBe(0);

    await disconnect();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

```bash
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api exec vitest run test/issueWeight.integration.test.ts
```

Očekávaný výsledek: FAIL, `Cannot find module '../src/services/issueWeight.js'`.

- [ ] **Step 3: Napiš službu**

Vytvoř `apps/api/src/services/issueWeight.ts`:

```ts
import type { Prisma } from "../../generated/prisma/client.js";

export function parseWeightValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(",", ".").trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatWeightKg(value: number): string {
  const normalized = Math.round(value * 100) / 100;
  return `${new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: normalized % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2
  }).format(normalized)} kg`;
}

/**
 * Váha celého výdeje akce. Množství se nejdřív sečte po položkách přes
 * všechny řádky výdeje a teprve pak se dopočítají celá master balení.
 * Počítat po dávkách by u víc dávek téže položky nafouklo počet balení.
 */
export async function computeIssuedWeightKg(
  tx: Prisma.TransactionClient,
  eventId: string
): Promise<number> {
  const totals = await tx.$queryRaw<Array<{ inventory_item_id: string; issued: number }>>`
    SELECT inventory_item_id::text AS inventory_item_id, COALESCE(SUM(issued_quantity), 0)::int AS issued
    FROM event_issues
    WHERE event_id = ${eventId}::uuid AND type = 'issued'
    GROUP BY inventory_item_id
  `;
  if (totals.length === 0) return 0;

  const items = await tx.inventoryItem.findMany({
    where: { id: { in: totals.map((t) => t.inventory_item_id) } },
    select: { id: true, masterPackageQty: true, masterPackageWeight: true }
  });
  const metaById = new Map(items.map((i) => [i.id, i]));

  return totals.reduce((sum, row) => {
    const meta = metaById.get(row.inventory_item_id);
    const packageWeightKg = parseWeightValue(meta?.masterPackageWeight);
    const packageQty = meta?.masterPackageQty ?? null;
    if (!packageWeightKg || !packageQty || packageQty <= 0) return sum;
    return sum + Math.ceil(Number(row.issued) / packageQty) * packageWeightKg;
  }, 0);
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

```bash
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api exec vitest run test/issueWeight.integration.test.ts
```

Očekávaný výsledek: PASS, 4 testy.

- [ ] **Step 5: Použij službu v `/issue` a smaž duplicitní kód**

V `apps/api/src/routes/events.ts` smaž lokální funkce `parseWeightValue` a `formatWeightKg` (jsou nad `EventCreateSchema`) a přidej import k ostatním službám:

```ts
import { computeIssuedWeightKg, formatWeightKg } from "../services/issueWeight.js";
```

V handleru `/events/:id/issue` smaž blok `const computedWeightKg = itemsToIssue.reduce(...)` a v `select` u `tx.inventoryItem.findMany` už nejsou potřeba `masterPackageQty` a `masterPackageWeight`, ponech jen `{ id: true, warehouseId: true }`.

Váhu spočítej až **po** `await tx.eventIssue.createMany(...)`, aby ji šlo vzít z databáze:

```ts
        const computedWeightKg = await computeIssuedWeightKg(tx, params.id);
```

Zbytek handleru zůstává, `totalWeight: computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null` funguje dál.

- [ ] **Step 6: Ověř, že nic jiného nespadlo**

```bash
pnpm --filter @cater-sklad/api exec tsc -p tsconfig.json --noEmit
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api test
```

Očekávaný výsledek: typecheck bez chyb, všechny testy zelené.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/issueWeight.ts apps/api/test/issueWeight.integration.test.ts apps/api/src/routes/events.ts
git commit -m "$(cat <<'EOF'
Vytahni prepocet vahy vydeje do sluzby

Vaha se nove pocita ze souctu mnozstvi po polozkach pres cely vydej,
ne po jednotlivych davkach. U vice davek tehoz zbozi by zaokrouhlovani
na cela master baleni nafouklo pocet baleni.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Doplňkový výdej, služba a endpoint

**Files:**
- Create: `apps/api/src/services/issueAdditional.ts`
- Create: `apps/api/test/issueAdditional.integration.test.ts`
- Modify: `apps/api/src/routes/events.ts` (nový handler za `/events/:id/issue`)

**Interfaces:**
- Consumes: `computeIssuedWeightKg`, `formatWeightKg` z Tasku 2.
- Produces: `issueAdditionalTx(params): Promise<{ issuedCount: number; totalWeight: string | null }>` kde
  `params = { tx: Prisma.TransactionClient; eventId: string; userId: string; idempotencyKey: string; warehouseId?: string; palletCount?: number | null; items: Array<{ inventoryItemId: string; qty: number }> }`

- [ ] **Step 1: Napiš padající test**

Vytvoř `apps/api/test/issueAdditional.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Role, LedgerReason, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getPhysicalTotal } from "../src/services/availability.js";
import { issueAdditionalTx } from "../src/services/issueAdditional.js";
import { returnCloseTx } from "../src/services/returnClose.js";

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function makeFixture(prisma: ReturnType<typeof createTestPrisma>["prisma"], status: EventStatus) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: { email: `add-${stamp}@local`, passwordHash: "x", role: Role.admin }
  });
  const warehouse = await prisma.warehouse.create({ data: { name: `SkladA-${stamp}` } });
  const parent = await prisma.category.create({ data: { name: `InventarA-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `SkloA-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({
    data: { name: `SkleniceA-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
  });
  await prisma.inventoryLedger.create({
    data: {
      inventoryItemId: item.id,
      deltaQuantity: 50,
      reason: LedgerReason.audit_adjustment,
      warehouseId: warehouse.id,
      createdById: user.id
    }
  });
  const event = await prisma.event.create({
    data: {
      name: `AkceA-${stamp}`,
      location: "Praha",
      deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
      pickupDatetime: new Date("2026-09-02T08:00:00Z"),
      status,
      createdById: user.id
    }
  });
  return { stamp, user, warehouse, item, event };
}

async function issueOriginal(
  prisma: ReturnType<typeof createTestPrisma>["prisma"],
  f: Fixture,
  qty: number
) {
  await prisma.eventIssue.create({
    data: {
      eventId: f.event.id,
      inventoryItemId: f.item.id,
      issuedQuantity: qty,
      type: "issued",
      warehouseId: f.warehouse.id,
      issuedById: f.user.id,
      idempotencyKey: `orig:${f.event.id}:${f.item.id}`
    }
  });
  await createInventoryLedgerEntry(prisma, {
    inventoryItemId: f.item.id,
    deltaQuantity: -qty,
    reason: LedgerReason.issue,
    eventId: f.event.id,
    warehouseId: f.warehouse.id,
    createdById: f.user.id,
    note: "Výdej na akci"
  });
}

describe("doplnkovy vydej (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("prida dalsi radek vydeje a odepise ze skladu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await issueOriginal(prisma, f, 10);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(40);

    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `add-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 4 }]
      })
    );

    const issues = await prisma.eventIssue.findMany({
      where: { eventId: f.event.id, inventoryItemId: f.item.id, type: "issued" }
    });
    expect(issues).toHaveLength(2);
    expect(issues.reduce((s, i) => s + i.issuedQuantity, 0)).toBe(14);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(36);

    await disconnect();
  });

  maybe("uzavreni akce secte oba vydeje", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await issueOriginal(prisma, f, 10);
    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `add2-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 4 }]
      })
    );

    // Vydano celkem 14, vrati se 12, jedna rozbita, jedna chybi.
    await prisma.$transaction((tx) =>
      returnCloseTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `close-${f.stamp}`,
        items: [
          {
            inventory_item_id: f.item.id,
            returned_quantity: 12,
            broken_quantity: 1,
            target_warehouse_id: f.warehouse.id
          }
        ]
      })
    );

    const losses = await prisma.eventIssue.findMany({
      where: { eventId: f.event.id, type: { in: ["broken", "missing"] } }
    });
    expect(losses.map((l) => [l.type, l.issuedQuantity]).sort()).toEqual([
      ["broken", 1],
      ["missing", 1]
    ]);
    // 50 na sklade, 14 vydano, 12 vraceno.
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(48);

    await disconnect();
  });

  maybe("odmitne vydej nad ramec dostupne zasoby", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await issueOriginal(prisma, f, 10);

    await expect(
      prisma.$transaction((tx) =>
        issueAdditionalTx({
          tx,
          eventId: f.event.id,
          userId: f.user.id,
          idempotencyKey: `over-${f.stamp}`,
          items: [{ inventoryItemId: f.item.id, qty: 999 }]
        })
      )
    ).rejects.toThrow("INSUFFICIENT_STOCK");

    await disconnect();
  });

  maybe("odmitne akci, ktera neni ve stavu ISSUED", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.SENT_TO_WAREHOUSE);

    await expect(
      prisma.$transaction((tx) =>
        issueAdditionalTx({
          tx,
          eventId: f.event.id,
          userId: f.user.id,
          idempotencyKey: `bad-${f.stamp}`,
          items: [{ inventoryItemId: f.item.id, qty: 1 }]
        })
      )
    ).rejects.toThrow("BAD_STATUS");

    await disconnect();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

```bash
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api exec vitest run test/issueAdditional.integration.test.ts
```

Očekávaný výsledek: FAIL, `Cannot find module '../src/services/issueAdditional.js'`.

- [ ] **Step 3: Napiš službu**

Vytvoř `apps/api/src/services/issueAdditional.ts`:

```ts
import { LedgerReason, type Prisma } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemTx } from "./availability.js";
import { computeIssuedWeightKg, formatWeightKg } from "./issueWeight.js";
import { createInventoryLedgerEntry } from "./ledger.js";
import { InsufficientStockError } from "./reserve.js";
import { requireWarehouseId } from "./warehouse.js";

export type IssueAdditionalItem = { inventoryItemId: string; qty: number };

/**
 * Doplňkový výdej do už vydané akce. Event manager často zavolá z terénu,
 * že do akce potřebuje ještě něco přihodit. Zboží odchází ze skladu teď,
 * takže se zapisuje jako další řádek výdeje, ne jako rezervace.
 */
export async function issueAdditionalTx(params: {
  tx: Prisma.TransactionClient;
  eventId: string;
  userId: string;
  idempotencyKey: string;
  warehouseId?: string;
  palletCount?: number | null;
  items: IssueAdditionalItem[];
}): Promise<{ issuedCount: number; totalWeight: string | null }> {
  const { tx, eventId, userId, idempotencyKey, warehouseId, palletCount, items } = params;

  const [event] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text FROM events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (!event) throw new Error("NOT_FOUND");
  if (event.status !== "ISSUED") throw new Error("BAD_STATUS");

  const positiveItems = items.filter((i) => i.qty > 0);
  if (positiveItems.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

  const duplicateIds = positiveItems
    .map((i) => i.inventoryItemId)
    .filter((id, idx, arr) => arr.indexOf(id) !== idx);
  if (duplicateIds.length > 0) throw new Error("DUPLICATE_ITEMS");

  const inventoryItems = await tx.inventoryItem.findMany({
    where: { id: { in: positiveItems.map((i) => i.inventoryItemId) } },
    select: { id: true, warehouseId: true }
  });
  if (inventoryItems.length !== positiveItems.length) throw new Error("ITEM_NOT_FOUND");
  const itemWarehouseById = new Map(inventoryItems.map((i) => [i.id, i.warehouseId]));

  for (const { inventoryItemId } of positiveItems) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2025, hashtext(${inventoryItemId}))`;
  }

  for (const { inventoryItemId, qty } of positiveItems) {
    const availability = await getAvailabilityForEventItemTx(tx, eventId, inventoryItemId);
    if (qty > availability.available) {
      throw new InsufficientStockError(inventoryItemId, availability.available);
    }
  }

  for (const { inventoryItemId, qty } of positiveItems) {
    const targetWarehouseId = requireWarehouseId({
      explicitWarehouseId: warehouseId,
      itemWarehouseId: itemWarehouseById.get(inventoryItemId) ?? null
    });

    await tx.eventIssue.create({
      data: {
        eventId,
        inventoryItemId,
        issuedQuantity: qty,
        type: "issued",
        warehouseId: targetWarehouseId,
        issuedById: userId,
        idempotencyKey: `${idempotencyKey}:${eventId}:${inventoryItemId}`
      }
    });

    await createInventoryLedgerEntry(tx, {
      inventoryItemId,
      deltaQuantity: -qty,
      reason: LedgerReason.issue,
      eventId,
      warehouseId: targetWarehouseId,
      createdById: userId,
      note: "Doplňkový výdej na akci"
    });
  }

  const computedWeightKg = await computeIssuedWeightKg(tx, eventId);
  const totalWeight = computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null;

  await tx.event.update({
    where: { id: eventId },
    data: {
      totalWeight,
      ...(palletCount !== undefined && palletCount !== null ? { palletCount } : {})
    }
  });

  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      entityType: "event",
      entityId: eventId,
      action: "issue_additional",
      diffJson: { items: positiveItems, palletCount: palletCount ?? null }
    }
  });

  return { issuedCount: positiveItems.length, totalWeight };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

```bash
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api exec vitest run test/issueAdditional.integration.test.ts
```

Očekávaný výsledek: PASS, 4 testy.

- [ ] **Step 5: Přidej endpoint**

V `apps/api/src/routes/events.ts` přidej import:

```ts
import { issueAdditionalTx } from "../services/issueAdditional.js";
```

Za handler `app.post("/events/:id/issue", ...)` vlož:

```ts
  app.post("/events/:id/issue-additional", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        idempotency_key: z.string().min(8),
        warehouse_id: z.string().uuid().optional(),
        pallet_count: z.number().int().min(0).optional().nullable(),
        items: z
          .array(
            z.object({
              inventory_item_id: z.string().uuid(),
              qty: z.number().int().min(1)
            })
          )
          .min(1)
      })
      .parse(request.body);

    try {
      const result = await app.prisma.$transaction((tx) =>
        issueAdditionalTx({
          tx,
          eventId: params.id,
          userId: user.id,
          idempotencyKey: body.idempotency_key,
          warehouseId: body.warehouse_id,
          palletCount: body.pallet_count,
          items: body.items.map((i) => ({ inventoryItemId: i.inventory_item_id, qty: i.qty }))
        })
      );

      sseBus.emit({ type: "reservation_changed", eventId: params.id });
      for (const item of body.items) {
        sseBus.emit({ type: "ledger_changed", inventoryItemId: item.inventory_item_id });
      }
      return reply.send(result);
    } catch (e: any) {
      if (e instanceof InsufficientStockError) {
        return httpError(reply, 409, "INSUFFICIENT_STOCK", "Nedostatečný stav skladu.", {
          inventory_item_id: e.inventoryItemId,
          available: e.available
        });
      }
      if (e?.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (e?.message === "BAD_STATUS")
        return httpError(reply, 409, "BAD_STATUS", "Doplňkový výdej lze udělat jen u vydané akce.");
      if (e?.message === "NO_ITEMS_TO_ISSUE")
        return httpError(reply, 409, "NO_ITEMS_TO_ISSUE", "Nezadal jsi žádné množství k vydání.");
      if (e?.message === "DUPLICATE_ITEMS")
        return httpError(reply, 409, "DUPLICATE_ITEMS", "Každá položka může být v doplňkovém výdeji jen jednou.");
      if (e?.message === "ITEM_NOT_FOUND")
        return httpError(reply, 404, "NOT_FOUND", "Některá položka už v inventáři neexistuje.");
      if (e?.message === "WAREHOUSE_REQUIRED")
        return httpError(reply, 409, "WAREHOUSE_REQUIRED", "Každá vydávaná položka musí mít určený sklad.");
      request.log.error({ err: e }, "issue-additional failed");
      return httpError(reply, 500, "INTERNAL", "Internal Server Error");
    }
  });
```

Ověř, že `InsufficientStockError` je v souboru importovaný. Pokud ne, přidej ho k importu ze `../services/reserve.js`.

- [ ] **Step 6: Ověř celý balík**

```bash
pnpm --filter @cater-sklad/api exec tsc -p tsconfig.json --noEmit
RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api test
```

Očekávaný výsledek: typecheck bez chyb, všechny testy zelené.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/issueAdditional.ts apps/api/test/issueAdditional.integration.test.ts apps/api/src/routes/events.ts
git commit -m "$(cat <<'EOF'
Pridej doplnkovy vydej do uz vydane akce

Event manager casto vola z terenu, ze do akce potrebuje jeste neco
prihodit. Zbozi odchazi ze skladu ted, takze se zapisuje jako dalsi
radek vydeje, ne jako rezervace. Vaha akce se prepocita z celeho vydeje.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Odblokování skladníka u cizí akce před výdejem

Čistě frontend, backend beze změny. Ověřeno, že `reserve`, `export` i `PATCH /events/:id` skladníka pouští bez ohledu na vlastnictví.

**Files:**
- Modify: `apps/web/src/pages/EventDetailPage.tsx:102-111`, `:164`, `:568-571`
- Modify: `apps/web/src/pages/WarehouseEventDetailPage.tsx:455-459`

**Interfaces:**
- Consumes: nic. Produces: nic pro další tasky.

- [ ] **Step 1: Uprav `canManageEvent`**

V `apps/web/src/pages/EventDetailPage.tsx` nahraď ř. 164:

```ts
  const canManageEvent = role === "admin" || (["event_manager", "warehouse"].includes(role) && isOwner);
```

tímto:

```ts
  // Sklad musi umet prihodit polozku do akce, kterou zalozil event manager:
  // ten v sezone casto vola z terenu, ze do akce jeste neco potrebuje.
  const canManageEvent = role === "admin" || role === "warehouse" || (role === "event_manager" && isOwner);
```

- [ ] **Step 2: Uprav kontrolu u deep linku**

Ve stejném souboru nahraď blok na ř. 108-111:

```ts
    if (["event_manager", "warehouse"].includes(role) && !isOwner) {
      deepLinkHandled.current = true;
      toast.error("Nemáte oprávnění přidávat položky do cizí akce.");
      return;
    }
```

tímto:

```ts
    if (role === "event_manager" && !isOwner) {
      deepLinkHandled.current = true;
      toast.error("Nemáte oprávnění přidávat položky do cizí akce.");
      return;
    }
```

- [ ] **Step 3: Uprav editaci jednotlivého řádku**

Ve stejném souboru nahraď ř. 569-571:

```ts
                              (role === "admin" ||
                                (["event_manager", "warehouse"].includes(role) && r.createdById === getCurrentUser()?.id) ||
                                (role === "chef" && String(g.parent).toLowerCase() === "kuchyň"));
```

tímto:

```ts
                              (role === "admin" ||
                                role === "warehouse" ||
                                (role === "event_manager" && r.createdById === getCurrentUser()?.id) ||
                                (role === "chef" && String(g.parent).toLowerCase() === "kuchyň"));
```

- [ ] **Step 4: Zobraz tlačítko úprav i u cizí akce**

V `apps/web/src/pages/WarehouseEventDetailPage.tsx` nahraď podmínku u tlačítka „Upravit akci a položky" (ř. 455-456):

```tsx
        {(role === "admin" || event.createdBy?.id === getCurrentUser()?.id) &&
        !["ISSUED", "CLOSED", "CANCELLED"].includes(event.status) ? (
```

tímto:

```tsx
        {!["ISSUED", "CLOSED", "CANCELLED"].includes(event.status) ? (
```

Podmínku na roli není potřeba: celá stránka je už na začátku komponenty vyhrazená rolím `warehouse` a `admin`.

- [ ] **Step 5: Ověř build**

```bash
pnpm --filter @cater-sklad/web build
```

Očekávaný výsledek: build projde bez chyb.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/EventDetailPage.tsx apps/web/src/pages/WarehouseEventDetailPage.tsx
git commit -m "$(cat <<'EOF'
Umozni skladnikovi upravovat polozky v cizi akci

Event manager v sezone dokonci akci a odjede do terenu, odkud vola na
sklad, ze do ni potrebuje jeste neco prihodit. Skladnik to dosud nemel
jak udelat, aplikace mu pridavani povolila jen u vlastnich akci.
Backend skladnika uz dnes pousti, blokoval to jen frontend.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Tlačítko „Vydat navíc" u vydané akce

Stávající `AddItemsPanel` v `EventDetailPage.tsx` je napevno svázaný s endpointem `reserve` a má přes 500 řádků. Přepojovat ho by ohrozilo hlavní tok event managera, proto vzniká samostatný, výrazně jednodušší modal.

**Files:**
- Create: `apps/web/src/components/AdditionalIssueModal.tsx`
- Modify: `apps/web/src/pages/WarehouseEventDetailPage.tsx`

**Interfaces:**
- Consumes: endpoint `POST /events/:id/issue-additional` z Tasku 3, endpoint `POST /events/:id/availability`.
- Produces: komponenta `AdditionalIssueModal` s props
  `{ open: boolean; onOpenChange: (v: boolean) => void; eventId: string; warehouses: Array<{ id: string; name: string }>; onDone: () => void }`

- [ ] **Step 1: Vytvoř modal**

Vytvoř `apps/web/src/components/AdditionalIssueModal.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Modal from "./ui/Modal";
import Select from "./ui/Select";
import { formatCategoryParentLabel } from "../lib/viewModel";

type CatalogItem = {
  id: string;
  name: string;
  unit: string;
  sku: string | null;
  category?: { name?: string; parent?: { name?: string } };
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  warehouses: Array<{ id: string; name: string }>;
  onDone: () => void;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export default function AdditionalIssueModal({ open, onOpenChange, eventId, warehouses, onDone }: Props) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [available, setAvailable] = useState<Map<string, number>>(new Map());
  const [warehouseId, setWarehouseId] = useState("");
  const [palletCount, setPalletCount] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setQty({});
      setAvailable(new Map());
      setWarehouseId("");
      setPalletCount("");
      return;
    }
    api<{ items: CatalogItem[] }>("/admin/items")
      .then((res) => setItems(res.items))
      .catch((e: unknown) => {
        const message = (e as { error?: { message?: string } })?.error?.message;
        toast.error(message ?? "Nepodařilo se načíst katalog.");
      });
  }, [open]);

  const matches = useMemo(() => {
    const tokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return items
      .filter((item) => {
        const haystack = normalizeSearchText(
          [item.name, item.sku, item.category?.name, item.category?.parent?.name].filter(Boolean).join(" ")
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 25);
  }, [items, search]);

  // Dostupnost se dotahuje az pro zobrazene polozky, katalog ma stovky radku.
  useEffect(() => {
    if (matches.length === 0) return;
    const missing = matches.map((m) => m.id).filter((id) => !available.has(id));
    if (missing.length === 0) return;
    api<{ rows: Array<{ inventoryItemId: string; available: number }> }>(`/events/${eventId}/availability`, {
      method: "POST",
      body: JSON.stringify({ inventory_item_ids: missing })
    })
      .then((res) => {
        setAvailable((prev) => {
          const next = new Map(prev);
          for (const row of res.rows) next.set(row.inventoryItemId, row.available);
          return next;
        });
      })
      .catch(() => {});
  }, [matches, eventId, available]);

  const basket = Object.entries(qty).filter(([, value]) => value > 0);

  const submit = async () => {
    if (basket.length === 0) {
      toast.error("Zadej u nějaké položky množství.");
      return;
    }
    setSaving(true);
    try {
      await api(`/events/${eventId}/issue-additional`, {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: `additional:${Date.now()}`,
          warehouse_id: warehouseId || undefined,
          pallet_count: palletCount === "" ? undefined : palletCount,
          items: basket.map(([inventoryItemId, value]) => ({
            inventory_item_id: inventoryItemId,
            qty: value
          }))
        })
      });
      toast.success("Doplňkový výdej zapsán");
      onOpenChange(false);
      onDone();
    } catch (e: unknown) {
      const message = (e as { error?: { message?: string } })?.error?.message;
      toast.error(message ?? "Doplňkový výdej se nepodařil.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Vydat navíc">
      <div className="space-y-4">
        <div className="text-sm text-slate-600">
          Zboží se odepíše ze skladu hned a přičte se k už vydanému množství akce.
        </div>

        <label className="block text-sm">
          Vydat ze skladu
          <Select className="mt-1" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">(Výchozí sklad položky)</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm">
          Počet palet po doplnění
          <Input
            className="mt-1"
            type="number"
            min={0}
            value={palletCount}
            onChange={(e) => setPalletCount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
            placeholder="Nechat beze změny"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Vyplň jen když přírůstek změnil počet palet. Prázdné pole nechá dosavadní hodnotu.
          </span>
        </label>

        <label className="block text-sm">
          Hledat položku
          <Input
            className="mt-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Název, SKU nebo kategorie…"
          />
        </label>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {search.trim() && matches.length === 0 ? (
            <div className="text-sm text-slate-500">Nic neodpovídá.</div>
          ) : null}
          {matches.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="text-xs text-slate-500">
                  {formatCategoryParentLabel(item.category?.parent?.name, item.category?.name)}
                  {available.has(item.id) ? ` • volné: ${available.get(item.id)} ${item.unit}` : ""}
                </div>
              </div>
              <Input
                className="w-24"
                type="number"
                min={0}
                value={qty[item.id] ?? ""}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  setQty((prev) => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value)) }))
                }
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={submit} disabled={saving || basket.length === 0}>
            Vydat navíc ({basket.length})
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Napoj modal na stránku skladu**

V `apps/web/src/pages/WarehouseEventDetailPage.tsx` přidej import:

```ts
import AdditionalIssueModal from "../components/AdditionalIssueModal";
```

Přidej stav vedle ostatních `useState` (u `showConfirmedList`):

```ts
  const [additionalIssueOpen, setAdditionalIssueOpen] = useState(false);
```

V kartě „Akce", ve větvi pro už vydanou akci, přidej tlačítko nad „Uzavřít akci". Nahraď blok:

```tsx
              <>
                <Button full variant="danger" disabled={closeDisabled} onClick={() => setConfirmClose(true)}>
                  Uzavřít akci
                </Button>
```

tímto:

```tsx
              <>
                {event.status === "ISSUED" ? (
                  <Button full variant="secondary" className="mb-2" onClick={() => setAdditionalIssueOpen(true)}>
                    <Icons.Box className="h-4 w-4" /> Vydat navíc
                  </Button>
                ) : null}
                <Button full variant="danger" disabled={closeDisabled} onClick={() => setConfirmClose(true)}>
                  Uzavřít akci
                </Button>
```

Modal vlož vedle ostatních modalů na konci komponenty, těsně před uzavírací `</div>`:

```tsx
      <AdditionalIssueModal
        open={additionalIssueOpen}
        onOpenChange={setAdditionalIssueOpen}
        eventId={id ?? ""}
        warehouses={warehouses}
        onDone={() => {
          load();
        }}
      />
```

- [ ] **Step 3: Ověř build**

```bash
pnpm --filter @cater-sklad/web build
```

Očekávaný výsledek: build projde bez chyb.

- [ ] **Step 4: Ověř v prohlížeči**

Rozjeď lokální prostředí podle Global Constraints, nasaď akci ve stavu `ISSUED` a projdi:

1. Na stránce skladu se u vydané akce zobrazí tlačítko „Vydat navíc".
2. Vyhledání položky bez diakritiky vrátí výsledky a ukáže volné množství.
3. Po zadání množství a potvrzení se seznam položek akce obnoví a přibude vydané množství.
4. Zadání většího množství, než je volné, skončí hláškou o nedostatečném stavu.
5. Vyplnění počtu palet se propíše do hlavičky akce, prázdné pole nechá původní hodnotu.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AdditionalIssueModal.tsx apps/web/src/pages/WarehouseEventDetailPage.tsx
git commit -m "$(cat <<'EOF'
Pridej tlacitko Vydat navic u vydane akce

Skladnik muze do uz vydane akce prihodit dalsi zbozi. Modal je zamerne
samostatny a jednoduchy: stavajici AddItemsPanel je napevno svazany
s rezervacemi a jeho prepojovani by ohrozilo tok event managera.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Závěrečná kontrola

- [ ] Celý balík testů zelený: `RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api test`
- [ ] Typecheck API: `pnpm --filter @cater-sklad/api exec tsc -p tsconfig.json --noEmit`
- [ ] Build webu: `pnpm --filter @cater-sklad/web build`
- [ ] Testovací databáze smazaná: `docker exec cater_sklad-db-1 psql -U cater -d postgres -c "DROP DATABASE IF EXISTS cater_test;"`
