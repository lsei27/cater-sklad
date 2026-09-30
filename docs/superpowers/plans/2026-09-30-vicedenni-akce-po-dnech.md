# Vícedenní akce po dnech: implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Řádky položek akce dostanou rozsah dnů, dostupnost se počítá po dnech a sklad balí a vydává vícedenní akci den po dni.

**Architecture:** Hranice dnů počítají tři SQL funkce (`event_day_count`, `event_day_start`, `event_day_end`) zavedené migrací. Na ně se napojí jediná sdílená implementace dostupnosti v `availability.ts`, která nahradí tři kopie téhož SQL. Rezervace, výdej a balení nesou `day_from` / `day_to` (`day_to = NULL` = do konce akce). Výdej se vytáhne z routy do služby `issueDay.ts` a dostane parametr dne. Na webu dostane EM volbu rozsahu v panelu přidávání a sklad novou kartu „Balení po dnech“, jednodenní akce zůstávají beze změny.

**Tech Stack:** Fastify 5, Prisma 7 (driver adapter pg), PostgreSQL 16 lokálně / Supabase v produkci, Vitest 4, React + Vite, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-30-vicedenni-akce-po-dnech-design.md`

## Global Constraints

- **Nikdy nepouštět Prisma CLI, testy ani dev server proti produkci.** `apps/api/.env` obsahuje produkční Supabase URL. Každý příkaz musí mít explicitně `DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad"`.
- Lokální DB nejde postavit přes `migrate deploy` (chybí migrace skladů). Postup: `docker compose up -d db`, v `apps/api` `DATABASE_URL=<lokální> npx prisma db push`, pak `DATABASE_URL=<lokální> npx prisma db execute --file prisma/migrations/20260930090000_multi_day_rows/migration.sql`.
- Merge do `main` spustí na Renderu `prisma migrate deploy`, tedy migraci na produkci. Migrace proto musí projít na lokální DB dřív, než se otevře PR.
- Práce na větvi `feature/vicedenni-akce-po-dnech`. Uživatel schválil průběžné commity na této větvi (kroky „Commit“). Push a PR jen na jeho výslovný pokyn.
- Git author email: `lukas.seifert8@gmail.com`.
- V novém TypeScript kódu žádné `any` (použij `unknown` nebo konkrétní typy).
- V textech (UI, komentáře, commit zprávy) nepoužívat dlouhou pomlčku `—`.
- Hranice dne je půlnoc v `Europe/Prague`. Den 1 začíná závozem akce, poslední den končí svozem.
- `day_to = NULL` znamená „do konce akce“. Rozsah končící posledním dnem se vždy ukládá jako `NULL`.
- Integrační testy: v `apps/api` `DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run <soubor>`. Bez `RUN_DB_TESTS=1` se tiše přeskočí.

## Review Focus

1. **Svoz krátce po půlnoci** (závoz 5. 10. 18:00, svoz 6. 10. 00:30): akce má 2 dny a den 2 trvá 30 minut. Očekávané chování podle rozhodnutí o hranici dne. Pokrývá test v Task 1.
2. **Dva řádky jedné položky v panelu EM** (50 ks celá akce + 70 ks den 2): úprava nebo smazání jednoho rozsahu nesmí přepsat druhý. Test v Task 3 („qty 0 smaže jen řádek daného rozsahu“).
3. **Akce vydané před nasazením**: po migraci nesmí sklad vidět „Den 1 k vydání“. Test v Task 6 („starý výdej se bere jako vydaný den 1“).
4. **Akce předaná skladu před nasazením**: její snapshot exportu nemá `dayFrom`, musí jít vydat jako dnes. Test v Task 6 („snapshot bez dnů se vydá jako den 1“).
5. **Doplňkový výdej u vícedenní akce** se nesmí počítat jako vydaný den. Test v Task 6.

---

### Task 1: Migrace, schéma a pomocné funkce pro dny

**Files:**
- Create: `apps/api/prisma/migrations/20260930090000_multi_day_rows/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (modely `EventReservation`, `EventIssue`, `EventPacking`)
- Create: `apps/api/src/lib/eventDays.ts`
- Test: `apps/api/test/eventDays.test.ts`, `apps/api/test/eventDaysSql.integration.test.ts`

**Interfaces:**
- Produces (SQL): `event_day_count(delivery timestamptz, pickup timestamptz) -> int`, `event_day_start(delivery timestamptz, day_no int) -> timestamptz`, `event_day_end(delivery timestamptz, pickup timestamptz, day_no int) -> timestamptz` (`day_no NULL` = svoz).
- Produces (TS, `src/lib/eventDays.ts`): `type DayRange = { dayFrom: number; dayTo: number | null }`, `WHOLE_EVENT: DayRange`, `eventDayCount(delivery: Date, pickup: Date): number`, `normalizeDayRange(input: { dayFrom?: number; dayTo?: number | null }, dayCount: number): DayRange | null`, `dayRangeKey(range: DayRange): string`.
- Produces (Prisma): `EventReservation.dayFrom: number`, `EventReservation.dayTo: number | null`, stejně `EventPacking`, a `EventIssue.dayFrom: number | null`, `EventIssue.dayTo: number | null`. Compound unique `eventId_inventoryItemId` u rezervace a balení zaniká.

- [ ] **Step 1: Založ větev a lokální DB**

Větev `feature/vicedenni-akce-po-dnech` už existuje (založena při commitu specifikace a plánu). Ověř, že jsi na ní, a zvedni DB:

```bash
cd /Users/lukasseifert/Development/Cater_sklad
git branch --show-current   # musí vypsat feature/vicedenni-akce-po-dnech
docker compose up -d db
```

- [ ] **Step 2: Napiš padající unit testy**

`apps/api/test/eventDays.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dayRangeKey, eventDayCount, normalizeDayRange } from "../src/lib/eventDays.js";

describe("eventDayCount", () => {
  it("jednodenní akce má 1 den", () => {
    expect(eventDayCount(new Date("2026-10-05T06:00:00Z"), new Date("2026-10-05T20:00:00Z"))).toBe(1);
  });

  it("počítá kalendářní dny v Praze, ne v UTC", () => {
    // Závoz 5. 10. 18:00 Praha, svoz 6. 10. 00:30 Praha. V UTC je to pořád 5. 10.
    expect(eventDayCount(new Date("2026-10-05T16:00:00Z"), new Date("2026-10-05T22:30:00Z"))).toBe(2);
  });

  it("přechod na zimní čas nerozbije počet dnů", () => {
    expect(eventDayCount(new Date("2026-10-24T06:00:00Z"), new Date("2026-10-26T18:00:00Z"))).toBe(3);
  });
});

describe("normalizeDayRange", () => {
  it("bez zadání je celá akce", () => {
    expect(normalizeDayRange({}, 3)).toEqual({ dayFrom: 1, dayTo: null });
  });

  it("rozsah do posledního dne se ukládá jako do konce akce", () => {
    expect(normalizeDayRange({ dayFrom: 2, dayTo: 3 }, 3)).toEqual({ dayFrom: 2, dayTo: null });
  });

  it("nechá rozsah uvnitř akce", () => {
    expect(normalizeDayRange({ dayFrom: 2, dayTo: 2 }, 3)).toEqual({ dayFrom: 2, dayTo: 2 });
  });

  it("odmítne den mimo akci a obrácený rozsah", () => {
    expect(normalizeDayRange({ dayFrom: 4 }, 3)).toBeNull();
    expect(normalizeDayRange({ dayFrom: 0 }, 3)).toBeNull();
    expect(normalizeDayRange({ dayFrom: 3, dayTo: 2 }, 3)).toBeNull();
    expect(normalizeDayRange({ dayFrom: 1, dayTo: 4 }, 3)).toBeNull();
  });
});

describe("dayRangeKey", () => {
  it("rozliší konec akce od konkrétního dne", () => {
    expect(dayRangeKey({ dayFrom: 1, dayTo: null })).toBe("1-end");
    expect(dayRangeKey({ dayFrom: 2, dayTo: 2 })).toBe("2-2");
  });
});
```

- [ ] **Step 3: Spusť testy, musí spadnout**

Run: `cd apps/api && npx vitest run test/eventDays.test.ts`
Expected: FAIL, modul `../src/lib/eventDays.js` neexistuje.

- [ ] **Step 4: Implementuj `src/lib/eventDays.ts`**

```ts
// Dny vícedenní akce. Hranice dne je půlnoc v Praze: API běží na Renderu
// v UTC, takže kalendářní datum se musí brát napevno v Europe/Prague.
// Stejná pravidla drží SQL funkce event_day_* z migrace 20260930090000.

const PRAGUE = "Europe/Prague";

/// Rozsah řádku akce. dayTo === null znamená „do konce akce“.
export type DayRange = { dayFrom: number; dayTo: number | null };

export const WHOLE_EVENT: DayRange = { dayFrom: 1, dayTo: null };

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRAGUE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function pragueDateAsUtcMs(d: Date): number {
  const [y, m, day] = ymd.format(d).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function eventDayCount(delivery: Date, pickup: Date): number {
  return Math.round((pragueDateAsUtcMs(pickup) - pragueDateAsUtcMs(delivery)) / 86_400_000) + 1;
}

/**
 * Ověří rozsah proti délce akce a sjednotí zápis: rozsah končící posledním
 * dnem se ukládá jako „do konce akce“ (null), aby se při prodloužení akce
 * prodloužil s ní a aby dva zápisy téhož rozsahu nevedly na dva řádky.
 */
export function normalizeDayRange(
  input: { dayFrom?: number; dayTo?: number | null },
  dayCount: number
): DayRange | null {
  const dayFrom = input.dayFrom ?? 1;
  const dayTo = input.dayTo ?? null;
  if (!Number.isInteger(dayFrom) || dayFrom < 1 || dayFrom > dayCount) return null;
  if (dayTo === null) return { dayFrom, dayTo: null };
  if (!Number.isInteger(dayTo) || dayTo < dayFrom || dayTo > dayCount) return null;
  return { dayFrom, dayTo: dayTo === dayCount ? null : dayTo };
}

export function dayRangeKey(range: DayRange): string {
  return `${range.dayFrom}-${range.dayTo ?? "end"}`;
}
```

- [ ] **Step 5: Spusť unit testy, musí projít**

Run: `cd apps/api && npx vitest run test/eventDays.test.ts`
Expected: PASS (9 testů).

- [ ] **Step 6: Napiš migraci**

`apps/api/prisma/migrations/20260930090000_multi_day_rows/migration.sql`:

```sql
-- Vícedenní akce: řádky rezervací, výdeje a balení nesou rozsah dnů.
-- day_to = NULL znamená „do konce akce“.
--
-- Migrace je psaná idempotentně (IF NOT EXISTS / OR REPLACE), aby šla pustit
-- přes `prisma db execute` i na lokální DB postavenou `prisma db push`, kde
-- sloupce už existují. Unikátní indexy s COALESCE Prisma ve schématu neumí,
-- žijí jen tady (stejná konvence jako check constraint na events).

-- Hranice dnů. Den 1 začíná závozem, další dny o půlnoci v Praze,
-- poslední den končí svozem.
CREATE OR REPLACE FUNCTION event_day_count(delivery timestamptz, pickup timestamptz)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT ((pickup AT TIME ZONE 'Europe/Prague')::date - (delivery AT TIME ZONE 'Europe/Prague')::date) + 1
$$;

CREATE OR REPLACE FUNCTION event_day_start(delivery timestamptz, day_no integer)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN day_no IS NULL OR day_no <= 1 THEN delivery
    ELSE (((delivery AT TIME ZONE 'Europe/Prague')::date + (day_no - 1))::timestamp AT TIME ZONE 'Europe/Prague')
  END
$$;

CREATE OR REPLACE FUNCTION event_day_end(delivery timestamptz, pickup timestamptz, day_no integer)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN day_no IS NULL OR day_no >= event_day_count(delivery, pickup) THEN pickup
    ELSE (((delivery AT TIME ZONE 'Europe/Prague')::date + day_no)::timestamp AT TIME ZONE 'Europe/Prague')
  END
$$;

-- Rezervace
ALTER TABLE "event_reservations" ADD COLUMN IF NOT EXISTS "day_from" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "event_reservations" ADD COLUMN IF NOT EXISTS "day_to" INTEGER;
-- V produkci je unikát constraint z init migrace, lokálně po db push index.
ALTER TABLE "event_reservations" DROP CONSTRAINT IF EXISTS "event_reservations_event_id_inventory_item_id_key";
DROP INDEX IF EXISTS "event_reservations_event_id_inventory_item_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "event_reservations_event_item_days_key"
  ON "event_reservations" ("event_id", "inventory_item_id", "day_from", COALESCE("day_to", 0));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_reservations_day_range_check') THEN
    ALTER TABLE "event_reservations" ADD CONSTRAINT "event_reservations_day_range_check"
      CHECK ("day_from" >= 1 AND ("day_to" IS NULL OR "day_to" >= "day_from"));
  END IF;
END $$;

-- Balení
ALTER TABLE "event_packing" ADD COLUMN IF NOT EXISTS "day_from" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "event_packing" ADD COLUMN IF NOT EXISTS "day_to" INTEGER;
ALTER TABLE "event_packing" DROP CONSTRAINT IF EXISTS "event_packing_event_id_inventory_item_id_key";
DROP INDEX IF EXISTS "event_packing_event_id_inventory_item_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "event_packing_event_item_days_key"
  ON "event_packing" ("event_id", "inventory_item_id", "day_from", COALESCE("day_to", 0));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_packing_day_range_check') THEN
    ALTER TABLE "event_packing" ADD CONSTRAINT "event_packing_day_range_check"
      CHECK ("day_from" >= 1 AND ("day_to" IS NULL OR "day_to" >= "day_from"));
  END IF;
END $$;

-- Výdej. Plánovaný výdej dne nese rozsah řádku, doplňkový výdej NULL = celá akce.
ALTER TABLE "event_issues" ADD COLUMN IF NOT EXISTS "day_from" INTEGER;
ALTER TABLE "event_issues" ADD COLUMN IF NOT EXISTS "day_to" INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_issues_day_range_check') THEN
    ALTER TABLE "event_issues" ADD CONSTRAINT "event_issues_day_range_check"
      CHECK ("day_from" IS NULL OR ("day_from" >= 1 AND ("day_to" IS NULL OR "day_to" >= "day_from")));
  END IF;
END $$;
-- Akce vydané před touto změnou mají vydaný den 1, jinak by sklad viděl
-- „Den 1 k vydání“ u akcí, které už odjely.
UPDATE "event_issues" SET "day_from" = 1 WHERE "day_from" IS NULL AND "type" = 'issued';
```

- [ ] **Step 7: Uprav `schema.prisma`**

V `model EventReservation` odstraň řádek `@@unique([eventId, inventoryItemId])` a přidej pole (za `expiresAt`) a komentář nad model:

```prisma
/// Unikátní klíč (event_id, inventory_item_id, day_from, COALESCE(day_to, 0))
/// je výrazový index z migrace 20260930090000_multi_day_rows, Prisma ho ve
/// schématu neumí. `prisma db push` ho proto nevytvoří, lokálně se musí
/// dopustit migrace přes `prisma db execute`.
model EventReservation {
  ...
  expiresAt        DateTime?        @map("expires_at") @db.Timestamptz(6)
  /// Rozsah dnů řádku. dayTo = null znamená „do konce akce“.
  dayFrom          Int              @default(1) @map("day_from")
  dayTo            Int?             @map("day_to")
  ...
}
```

V `model EventPacking` stejně: odstraň `@@unique([eventId, inventoryItemId])`, přidej `dayFrom Int @default(1) @map("day_from")` a `dayTo Int? @map("day_to")` a do komentáře nad modelem doplň větu o výrazovém indexu z migrace.

V `model EventIssue` přidej za `notes`:

```prisma
  /// Rozsah plánovaného řádku, ze kterého výdej vznikl. Doplňkový výdej má
  /// null = celá akce. Vydané dny akce = rozlišné dayFrom řádků typu issued.
  dayFrom         Int?     @map("day_from")
  dayTo           Int?     @map("day_to")
```

- [ ] **Step 8: Promítni schéma a migraci do lokální DB a vygeneruj klienta**

```bash
cd apps/api
export DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad"
npx prisma migrate status   # musí vypsat localhost:5432, jinak STOP
npx prisma db push
npx prisma db execute --file prisma/migrations/20260930090000_multi_day_rows/migration.sql
npx prisma generate
```

Expected: `db push` hlásí synchronizaci, `db execute` projde bez chyby. Druhé spuštění `db execute` musí projít také (idempotence).

- [ ] **Step 9: Napiš integrační test SQL funkcí**

`apps/api/test/eventDaysSql.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestPrisma } from "./testPrisma.js";

describe("SQL funkce dnů akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("hranice dnů jsou půlnoci v Praze i přes změnu času", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    // Sobota 24. 10. 2026 8:00 letního času, svoz pondělí 26. 10. 19:00 zimního času.
    const delivery = new Date("2026-10-24T06:00:00Z");
    const pickup = new Date("2026-10-26T18:00:00Z");

    const [row] = await prisma.$queryRaw<
      Array<{ n: number; s1: Date; s2: Date; s3: Date; e1: Date; e2: Date; e3: Date; enull: Date }>
    >`
      SELECT
        event_day_count(${delivery}::timestamptz, ${pickup}::timestamptz)::int AS n,
        event_day_start(${delivery}::timestamptz, 1) AS s1,
        event_day_start(${delivery}::timestamptz, 2) AS s2,
        event_day_start(${delivery}::timestamptz, 3) AS s3,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, 1) AS e1,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, 2) AS e2,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, 3) AS e3,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, NULL) AS enull
    `;

    expect(row.n).toBe(3);
    expect(row.s1.toISOString()).toBe(delivery.toISOString());
    // Neděle 25. 10. 0:00 je ještě letní čas (UTC+2).
    expect(row.s2.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    // Pondělí 26. 10. 0:00 už je zimní čas (UTC+1).
    expect(row.s3.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(row.e1.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(row.e2.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(row.e3.toISOString()).toBe(pickup.toISOString());
    expect(row.enull.toISOString()).toBe(pickup.toISOString());

    await disconnect();
  });

  maybe("SQL a TypeScript počítají stejný počet dnů", async () => {
    const { eventDayCount } = await import("../src/lib/eventDays.js");
    const { prisma, disconnect } = createTestPrisma(url!);
    const cases: Array<[string, string]> = [
      ["2026-10-05T06:00:00Z", "2026-10-05T20:00:00Z"],
      ["2026-10-05T16:00:00Z", "2026-10-05T22:30:00Z"],
      ["2026-10-24T06:00:00Z", "2026-10-26T18:00:00Z"],
      ["2026-03-28T08:00:00Z", "2026-03-30T08:00:00Z"]
    ];
    for (const [d, p] of cases) {
      const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT event_day_count(${new Date(d)}::timestamptz, ${new Date(p)}::timestamptz)::int AS n
      `;
      expect(row.n).toBe(eventDayCount(new Date(d), new Date(p)));
    }
    await disconnect();
  });
});
```

- [ ] **Step 10: Spusť integrační test a celý stávající test suite**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/eventDaysSql.integration.test.ts`
Expected: PASS.

Run: `cd apps/api && npx tsc -p tsconfig.typecheck.json`
Expected: chyby jen v místech, která používají `eventId_inventoryItemId` (`src/services/reserve.ts`, `src/routes/events.ts` u balení). Ty opraví Task 3 a Task 6. Zapiš si jejich seznam, jiné chyby nesmí být.

- [ ] **Step 11: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/eventDays.ts apps/api/test/eventDays.test.ts apps/api/test/eventDaysSql.integration.test.ts
git commit -m "Přidej rozsah dnů k řádkům akce a SQL funkce hranic dnů"
```

---

### Task 2: Sdílený výpočet dostupnosti po dnech (včetně opravy dvojího odečtu)

**Files:**
- Modify: `apps/api/src/services/availability.ts` (celý soubor přepsán, `getPhysicalTotal` a `getWarehouseQuantity` beze změny)
- Modify: `apps/api/src/routes/inventory.ts` (dva bloky `const stockRows = ...` v `GET /inventory/items` a `GET /inventory/items/:id/cross-sells`)
- Modify: `apps/api/src/services/issueAdditional.ts:53` (volání dostupnosti)
- Modify: `apps/api/src/routes/events.ts:504-532` (obě routy `/availability`)
- Test: `apps/api/test/availabilityDays.integration.test.ts`

**Interfaces:**
- Consumes: SQL funkce z Task 1, `DayRange`, `WHOLE_EVENT`, `normalizeDayRange` z `src/lib/eventDays.ts`.
- Oprava chyby: řádek rezervace, ke kterému existuje řádek výdeje se stejným klíčem (akce, položka, `day_from`, `day_to`), už neblokuje. Výdej ho odečetl z fyzického stavu a vrací se virtuálním návratem.
- Produces:
  - `type AvailabilityExclusion = { kind: "none" } | { kind: "event"; eventId: string } | { kind: "row"; eventId: string; range: DayRange }`
  - `getItemsAvailabilityTx(tx, { itemIds: string[]; start: Date; end: Date; exclude: AvailabilityExclusion }): Promise<EventItemAvailability[]>`
  - `getAvailabilityForEventItemsTx(tx, eventId: string, itemIds: string[], options?: { range?: DayRange; excludeWholeEvent?: boolean }): Promise<EventItemAvailability[]>`. Rozsah se normalizuje proti délce akce; neplatný rozsah vyhodí `Error("INVALID_DAY_RANGE")`, neexistující akce `Error("EVENT_NOT_FOUND")`.
  - `getAvailabilityForEventItemTx(tx, eventId, itemId, options?)` se stejnými volbami.

- [ ] **Step 1: Napiš padající integrační testy**

`apps/api/test/availabilityDays.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getAvailabilityForEventItemTx } from "../src/services/availability.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

// Třídenní akce A: 1. 7. 2030 8:00 až 3. 7. 2030 20:00 (letní čas, UTC+2).
const A_DELIVERY = "2030-07-01T06:00:00Z";
const A_PICKUP = "2030-07-03T18:00:00Z";
// Jednodenní akce v den 2 a den 3 akce A.
const DAY2 = ["2030-07-02T06:00:00Z", "2030-07-02T18:00:00Z"] as const;
const DAY3 = ["2030-07-03T06:00:00Z", "2030-07-03T10:00:00Z"] as const;

async function setup(prisma: TestPrisma, opts: { stock: number; returnDelayDays?: number }) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({
    data: { email: `days-${stamp}@local`, passwordHash: "x", role: Role.admin }
  });
  const parent = await prisma.category.create({ data: { name: `Inventar-days-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Stoly-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({
    data: { name: `Stul-${stamp}`, categoryId: child.id, unit: "ks", returnDelayDays: opts.returnDelayDays ?? 0 }
  });
  await prisma.inventoryLedger.create({
    data: { inventoryItemId: item.id, deltaQuantity: opts.stock, reason: LedgerReason.audit_adjustment, createdById: user.id }
  });
  const makeEvent = (name: string, delivery: string, pickup: string, status: EventStatus = EventStatus.READY_FOR_WAREHOUSE) =>
    prisma.event.create({
      data: {
        name: `${name}-${stamp}`,
        location: "L",
        deliveryDatetime: new Date(delivery),
        pickupDatetime: new Date(pickup),
        status,
        createdById: user.id
      }
    });
  const reserve = (eventId: string, qty: number, dayFrom = 1, dayTo: number | null = null) =>
    prisma.eventReservation.create({
      data: { eventId, inventoryItemId: item.id, reservedQuantity: qty, state: "confirmed", dayFrom, dayTo }
    });
  const availability = (eventId: string, options?: Parameters<typeof getAvailabilityForEventItemTx>[3]) =>
    prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, eventId, item.id, options));
  return { user, item, makeEvent, reserve, availability };
}

describe("dostupnost po dnech (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("stoly jen na den 1 jsou pro jinou akci volné od dne 2", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 10, 1, 1);
    const b = await f.makeEvent("B", ...DAY2);

    const res = await f.availability(b.id);
    expect(res.blockedTotal).toBe(0);
    expect(res.available).toBe(10);
    await disconnect();
  });

  maybe("řádek na celou akci blokuje i den 2", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 10);
    const b = await f.makeEvent("B", ...DAY2);

    expect((await f.availability(b.id)).available).toBe(0);
    await disconnect();
  });

  maybe("souběžné řádky se sčítají jen tam, kde se překrývají", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 150 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 50);
    await f.reserve(a.id, 70, 2, 2);
    const b = await f.makeEvent("B", ...DAY2);
    const c = await f.makeEvent("C", ...DAY3);

    const onDay2 = await f.availability(b.id);
    expect(onDay2.blockedTotal).toBe(120);
    expect(onDay2.available).toBe(30);
    const onDay3 = await f.availability(c.id);
    expect(onDay3.blockedTotal).toBe(50);
    expect(onDay3.available).toBe(100);
    await disconnect();
  });

  maybe("řádky téže akce si navzájem hlídají kapacitu, vlastní řádek se nepočítá", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 50);

    expect((await f.availability(a.id, { range: { dayFrom: 2, dayTo: 2 } })).available).toBe(50);
    // Úprava stávajícího řádku (stejný rozsah) jeho původní množství nepočítá.
    expect((await f.availability(a.id)).available).toBe(100);
    // Rozsah zadaný až do posledního dne je tentýž řádek jako „do konce akce“.
    expect((await f.availability(a.id, { range: { dayFrom: 1, dayTo: 3 } })).available).toBe(100);
    await disconnect();
  });

  maybe("excludeWholeEvent vynechá všechny řádky vlastní akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 50);
    await f.reserve(a.id, 30, 2, 2);

    expect((await f.availability(a.id, { excludeWholeEvent: true })).available).toBe(100);
    await disconnect();
  });

  maybe("prodleva vrácení prodlužuje blokaci rezervace", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10, returnDelayDays: 1 });
    const a = await f.makeEvent("A", "2030-07-01T06:00:00Z", "2030-07-01T18:00:00Z");
    await f.reserve(a.id, 10);
    const b = await f.makeEvent("B", ...DAY2);

    expect((await f.availability(b.id)).available).toBe(0);
    await disconnect();
  });

  maybe("akce, které se v cílovém okně nepřekrývají, se nesčítají", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 20 });
    const x = await f.makeEvent("X", "2030-07-01T06:00:00Z", "2030-07-01T08:00:00Z");
    const y = await f.makeEvent("Y", "2030-07-01T12:00:00Z", "2030-07-01T14:00:00Z");
    await f.reserve(x.id, 8);
    await f.reserve(y.id, 5);
    const target = await f.makeEvent("T", "2030-07-01T05:00:00Z", "2030-07-01T17:00:00Z");

    const res = await f.availability(target.id);
    expect(res.blockedTotal).toBe(8);
    expect(res.available).toBe(12);
    await disconnect();
  });

  maybe("vydaný řádek dne 1 se virtuálně vrací od konce dne 1", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await f.reserve(a.id, 10, 1, 1);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 10,
        type: "issued",
        issuedById: f.user.id,
        dayFrom: 1,
        dayTo: 1,
        idempotencyKey: `vr:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -10,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej na akci"
    });
    const b = await f.makeEvent("B", ...DAY2);

    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(10);
    expect(res.available).toBe(10);
    await disconnect();
  });

  maybe("doplňkový výdej bez rozsahu se vrací až po svozu akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 5,
        type: "issued",
        issuedById: f.user.id,
        idempotencyKey: `add:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -5,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Doplňkový výdej na akci"
    });
    const b = await f.makeEvent("B", ...DAY2);

    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(5);
    expect(res.available).toBe(5);
    await disconnect();
  });

  maybe("vydaný řádek neblokuje podruhé, výdej už snížil fyzický stav", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", "2030-07-01T06:00:00Z", "2030-07-02T18:00:00Z", EventStatus.ISSUED);
    await f.reserve(a.id, 5);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 5,
        type: "issued",
        issuedById: f.user.id,
        dayFrom: 1,
        idempotencyKey: `dbl:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -5,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej na akci"
    });
    const b = await f.makeEvent("B", "2030-07-02T06:00:00Z", "2030-07-02T12:00:00Z");

    // Dřív: fyzicky 5, blokováno 5 rezervací A, volné 0. Kusy na akci A se ale
    // odečetly už výdejem, sklad má skutečně 5 volných.
    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(5);
    expect(res.blockedTotal).toBe(0);
    expect(res.available).toBe(5);
    await disconnect();
  });

  maybe("nevydaný den vydané akce dál blokuje", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await f.reserve(a.id, 50, 1, 1);
    await f.reserve(a.id, 30, 2, 2);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 50,
        type: "issued",
        issuedById: f.user.id,
        dayFrom: 1,
        dayTo: 1,
        idempotencyKey: `part:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -50,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej na akci"
    });
    const b = await f.makeEvent("B", ...DAY2);

    // Den 1 se vrátil virtuálně (konec dne 1 je před B), den 2 ještě nevydaný blokuje 30.
    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(100);
    expect(res.blockedTotal).toBe(30);
    expect(res.available).toBe(70);
    await disconnect();
  });

  maybe("neplatný rozsah se odmítne", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);

    await expect(f.availability(a.id, { range: { dayFrom: 4, dayTo: null } })).rejects.toThrow("INVALID_DAY_RANGE");
    await disconnect();
  });
});
```

- [ ] **Step 2: Spusť testy, musí spadnout**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/availabilityDays.integration.test.ts`
Expected: FAIL. Typová chyba u `options` (čtvrtý parametr neexistuje) nebo špatné hodnoty (`stoly jen na den 1` vrátí 0).

- [ ] **Step 3: Přepiš `src/services/availability.ts`**

Nahraď vše od začátku souboru po konec funkce `getAvailabilityForEventItemTx` (funkce `getPhysicalTotal` a `getWarehouseQuantity` nech beze změny):

```ts
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { normalizeDayRange, WHOLE_EVENT, type DayRange } from "../lib/eventDays.js";

export type EventItemAvailability = {
  inventoryItemId: string;
  physicalTotal: number;
  blockedTotal: number;
  available: number;
};

/// Koho výpočet vynechá z blokace.
/// - none: skladové přehledy, počítá se všechno.
/// - event: doplňkový výdej, vlastní akce se vynechá celá.
/// - row: rezervace a „Volné“ u řádku. Vynechá se jen řádek se stejným klíčem
///   (akce, položka, rozsah), ostatní řádky téže akce blokují. Jinak by si dva
///   řádky jedné akce navzájem nekontrolovaly kapacitu.
/// Ruční blokace vlastní akce se vynechávají v režimu event i row.
export type AvailabilityExclusion =
  | { kind: "none" }
  | { kind: "event"; eventId: string }
  | { kind: "row"; eventId: string; range: DayRange };

type BulkAvailabilityRow = {
  inventory_item_id: string;
  physical_total: number;
  blocked_total: number;
  available: number;
};

/**
 * Jediná implementace dostupnosti. Detail akce i skladové přehledy musí počítat
 * stejně, dřív byly tři kopie téhož SQL.
 *
 * Dostupné = fyzický stav + virtuální návraty - špička souběžného vytížení
 * v intervalu <start, end). Vytížení se mění jen tam, kde nějaký blokující úsek
 * začíná, takže špičku stačí hledat v těchto bodech a na začátku intervalu.
 */
export async function getItemsAvailabilityTx(
  tx: Prisma.TransactionClient,
  params: { itemIds: string[]; start: Date; end: Date; exclude: AvailabilityExclusion }
): Promise<EventItemAvailability[]> {
  const uniqueItemIds = Array.from(new Set(params.itemIds));
  if (uniqueItemIds.length === 0) return [];

  const { start, end, exclude } = params;
  const excludeEventId = exclude.kind === "none" ? null : exclude.eventId;
  const excludeWholeEvent = exclude.kind === "event";
  const excludeDayFrom = exclude.kind === "row" ? exclude.range.dayFrom : null;
  const excludeDayTo = exclude.kind === "row" ? exclude.range.dayTo : null;

  const rows = await tx.$queryRaw<BulkAvailabilityRow[]>`
WITH items AS (
  SELECT DISTINCT UNNEST(${uniqueItemIds}::uuid[]) AS inventory_item_id
),
physical AS (
  SELECT
    l.inventory_item_id,
    COALESCE(SUM(l.delta_quantity), 0) AS physical_total
  FROM inventory_ledger l
  WHERE l.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
  GROUP BY l.inventory_item_id
),
-- Vratná položka je dostupná až po konci svého řádku výdeje a prodlevě.
-- Doplňkový výdej nemá rozsah (day_to NULL) a platí do svozu akce.
-- Spotřební zboží se nevrací.
virtual_returns AS (
  SELECT
    ei.inventory_item_id,
    COALESCE(SUM(ei.issued_quantity), 0) AS virtual_qty
  FROM event_issues ei
  JOIN events e ON e.id = ei.event_id
  JOIN inventory_items ii ON ii.id = ei.inventory_item_id
  WHERE ei.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND e.status = 'ISSUED'
    AND ei.type = 'issued'
    AND ii.consumable = false
    AND event_day_end(e.delivery_datetime, e.pickup_datetime, ei.day_to)
        + make_interval(days => ii.return_delay_days) <= ${start}::timestamptz
  GROUP BY ei.inventory_item_id
),
-- Blokující úseky: řádek rezervace od začátku svého prvního dne do konce
-- posledního dne plus prodleva vrácení, nebo ruční blokace skladu do blocked_until.
loads AS (
  SELECT
    r.inventory_item_id,
    r.event_id,
    r.reserved_quantity AS res_qty,
    0 AS block_qty,
    event_day_start(e.delivery_datetime, r.day_from) AS s,
    event_day_end(e.delivery_datetime, e.pickup_datetime, r.day_to)
      + make_interval(days => ii.return_delay_days) AS f
  FROM event_reservations r
  JOIN events e ON e.id = r.event_id
  JOIN inventory_items ii ON ii.id = r.inventory_item_id
  WHERE r.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND (r.state = 'confirmed' OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW()))
    AND e.status NOT IN ('CLOSED','CANCELLED')
    -- Vydaný řádek už snížil fyzický stav výdejem a vrací se virtuálním
    -- návratem. Kdyby blokoval i rezervací, odečetl by se dvakrát.
    AND NOT EXISTS (
      SELECT 1 FROM event_issues ei
      WHERE ei.event_id = r.event_id
        AND ei.inventory_item_id = r.inventory_item_id
        AND ei.type = 'issued'
        AND ei.day_from = r.day_from
        AND COALESCE(ei.day_to, 0) = COALESCE(r.day_to, 0)
    )
    AND NOT COALESCE(
      r.event_id = ${excludeEventId}::uuid
      AND (
        ${excludeWholeEvent}::boolean
        OR (r.day_from = ${excludeDayFrom}::int AND COALESCE(r.day_to, 0) = COALESCE(${excludeDayTo}::int, 0))
      ),
      false
    )
  UNION ALL
  SELECT
    wb.inventory_item_id,
    wb.event_id,
    0,
    wb.blocked_quantity,
    '-infinity'::timestamptz,
    wb.blocked_until
  FROM warehouse_blocks wb
  WHERE wb.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND wb.event_id IS DISTINCT FROM ${excludeEventId}::uuid
),
active AS (
  SELECT * FROM loads
  WHERE s < ${end}::timestamptz AND ${start}::timestamptz < f
),
points AS (
  SELECT inventory_item_id, ${start}::timestamptz AS p FROM items
  UNION
  SELECT inventory_item_id, s FROM active WHERE s > ${start}::timestamptz
),
-- Za každou akci v daném bodě blokuje větší hodnota z rezervací a ruční blokace.
per_event AS (
  SELECT
    pt.inventory_item_id,
    pt.p,
    a.event_id,
    GREATEST(SUM(a.res_qty), MAX(a.block_qty)) AS qty
  FROM points pt
  JOIN active a
    ON a.inventory_item_id = pt.inventory_item_id
    AND a.s <= pt.p
    AND pt.p < a.f
  GROUP BY pt.inventory_item_id, pt.p, a.event_id
),
blocked AS (
  SELECT inventory_item_id, MAX(total) AS blocked_total
  FROM (
    SELECT inventory_item_id, p, SUM(qty) AS total
    FROM per_event
    GROUP BY inventory_item_id, p
  ) x
  GROUP BY inventory_item_id
)
SELECT
  i.inventory_item_id::text,
  (COALESCE(p.physical_total, 0) + COALESCE(vr.virtual_qty, 0)) AS physical_total,
  COALESCE(b.blocked_total, 0) AS blocked_total,
  (COALESCE(p.physical_total, 0) + COALESCE(vr.virtual_qty, 0) - COALESCE(b.blocked_total, 0)) AS available
FROM items i
LEFT JOIN physical p ON p.inventory_item_id = i.inventory_item_id
LEFT JOIN virtual_returns vr ON vr.inventory_item_id = i.inventory_item_id
LEFT JOIN blocked b ON b.inventory_item_id = i.inventory_item_id;
  `;

  const availabilityByItemId = new Map(
    rows.map((row) => [
      row.inventory_item_id,
      {
        inventoryItemId: row.inventory_item_id,
        physicalTotal: Number(row.physical_total),
        blockedTotal: Number(row.blocked_total),
        available: Number(row.available)
      }
    ])
  );

  return uniqueItemIds.map(
    (inventoryItemId) =>
      availabilityByItemId.get(inventoryItemId) ?? {
        inventoryItemId,
        physicalTotal: 0,
        blockedTotal: 0,
        available: 0
      }
  );
}

export type EventAvailabilityOptions = {
  /// Rozsah řádku, pro který se dostupnost počítá. Výchozí je celá akce.
  range?: DayRange;
  /// Doplňkový výdej: vlastní akce se vynechá celá.
  excludeWholeEvent?: boolean;
};

export async function getAvailabilityForEventItemsTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemIds: string[],
  options: EventAvailabilityOptions = {}
): Promise<EventItemAvailability[]> {
  const [ev] = await tx.$queryRaw<Array<{ delivery: Date; pickup: Date; day_count: number }>>`
    SELECT delivery_datetime AS delivery, pickup_datetime AS pickup,
           event_day_count(delivery_datetime, pickup_datetime)::int AS day_count
    FROM events WHERE id = ${targetEventId}::uuid
  `;
  if (!ev) throw new Error("EVENT_NOT_FOUND");

  const range = normalizeDayRange(options.range ?? WHOLE_EVENT, Number(ev.day_count));
  if (!range) throw new Error("INVALID_DAY_RANGE");

  const [interval] = await tx.$queryRaw<Array<{ t_start: Date; t_end: Date }>>`
    SELECT event_day_start(${ev.delivery}::timestamptz, ${range.dayFrom}::int) AS t_start,
           event_day_end(${ev.delivery}::timestamptz, ${ev.pickup}::timestamptz, ${range.dayTo}::int) AS t_end
  `;

  return getItemsAvailabilityTx(tx, {
    itemIds: inventoryItemIds,
    start: interval.t_start,
    end: interval.t_end,
    exclude: options.excludeWholeEvent
      ? { kind: "event", eventId: targetEventId }
      : { kind: "row", eventId: targetEventId, range }
  });
}

export async function getAvailabilityForEventItemTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemId: string,
  options: EventAvailabilityOptions = {}
) {
  const [row] = await getAvailabilityForEventItemsTx(tx, targetEventId, [inventoryItemId], options);
  return row
    ? {
        physicalTotal: row.physicalTotal,
        blockedTotal: row.blockedTotal,
        available: row.available
      }
    : { physicalTotal: 0, blockedTotal: 0, available: 0 };
}
```

- [ ] **Step 4: Doplňkový výdej vynechá celou vlastní akci**

V `src/services/issueAdditional.ts` ve smyčce kontroly dostupnosti nahraď:

```ts
    const availability = await getAvailabilityForEventItemTx(tx, eventId, inventoryItemId);
```

za:

```ts
    // Doplňkový výdej je navíc k plánu, vlastní rezervace akce ho nesmí blokovat.
    const availability = await getAvailabilityForEventItemTx(tx, eventId, inventoryItemId, { excludeWholeEvent: true });
```

- [ ] **Step 5: Skladové přehledy přes sdílenou funkci**

V `src/routes/inventory.ts` přidej import:

```ts
import { getItemsAvailabilityTx } from "../services/availability.js";
```

V handleru `GET /inventory/items` nahraď celý příkaz `const stockRows = await app.prisma.$transaction(async (tx) => { ... });` (od `const stockRows` po uzavírací `});` za SQL) tímto:

```ts
    const stockRows = await app.prisma.$transaction(async (tx) => {
      const rows = await getItemsAvailabilityTx(tx, {
        itemIds,
        start: startAt,
        end: endAt,
        exclude: { kind: "none" }
      });
      return rows.map((r) => ({
        inventory_item_id: r.inventoryItemId,
        physical_total: r.physicalTotal,
        blocked_total: r.blockedTotal,
        available: r.available
      }));
    });
```

V handleru `GET /inventory/items/:id/cross-sells` udělej totéž, jen s `itemIds: targetItemIds`. Kód za tím (`const stockById = new Map(...)`) zůstává beze změny.

- [ ] **Step 6: Routy `/availability` přijmou rozsah**

V `src/routes/events.ts` v `app.post("/events/:id/availability", ...)` nahraď schéma a volání:

```ts
    const body = z
      .object({
        inventory_item_ids: z.array(z.string().uuid()).min(1).max(1000),
        day_from: z.number().int().min(1).optional(),
        day_to: z.number().int().min(1).nullable().optional()
      })
      .parse(request.body);

    try {
      const rows = await app.prisma.$transaction((tx) =>
        getAvailabilityForEventItemsTx(tx, params.id, body.inventory_item_ids, {
          range: { dayFrom: body.day_from ?? 1, dayTo: body.day_to ?? null }
        })
      );
      return { rows };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      if (message === "EVENT_NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (message === "INVALID_DAY_RANGE") return httpError(reply, 400, "INVALID_DAY_RANGE", "Neplatný rozsah dnů akce.");
      throw e;
    }
```

V `app.get("/events/:id/availability", ...)` obal volání `getAvailabilityForEventItemTx` stejným `try/catch` pro `EVENT_NOT_FOUND`.

- [ ] **Step 7: Spusť nové i stávající testy dostupnosti**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/availabilityDays.integration.test.ts test/availability.integration.test.ts test/consumable.integration.test.ts test/issueAdditional.integration.test.ts`
Expected: PASS všech. Pokud stávající test spadne kvůli prodlevě (Task spec, „Změna výsledků u stávajících akcí“), neuprav test naslepo: zastav se a ukaž uživateli, který test a proč.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/availability.ts apps/api/src/services/issueAdditional.ts apps/api/src/routes/inventory.ts apps/api/src/routes/events.ts apps/api/test/availabilityDays.integration.test.ts
git commit -m "Počítej dostupnost podle dnů řádků a neodečítej vydané zboží dvakrát"
```

---

### Task 3: Rezervace s rozsahem dnů

**Files:**
- Modify: `apps/api/src/services/reserve.ts` (celý soubor)
- Modify: `apps/api/src/routes/events.ts` (`POST /events/:id/reserve`, `GET /events/:id/packing-changes`)
- Test: `apps/api/test/reserveDays.integration.test.ts`

**Interfaces:**
- Consumes: `getAvailabilityForEventItemsTx(tx, eventId, ids, { range })`, `normalizeDayRange`, `dayRangeKey`.
- Produces: `type ReserveItemInput = { inventoryItemId: string; qty: number; dayFrom?: number; dayTo?: number | null }`, `reserveItemsTx({ tx, actor, eventId, items: ReserveItemInput[] })` vrací `{ state, expiresAt, masterPackageAdjustments: Array<{ inventoryItemId; dayFrom; dayTo; requestedQty; adjustedQty; masterPackageQty }> }`. Nová chyba `Error("INVALID_DAY_RANGE")`. Záznam auditu `packing_changed` má u změn `dayFrom` a `dayTo`.

- [ ] **Step 1: Napiš padající testy**

`apps/api/test/reserveDays.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { InsufficientStockError, reserveItemsTx } from "../src/services/reserve.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma, stock: number) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({
    data: { email: `resdays-${stamp}@local`, passwordHash: "x", role: Role.admin }
  });
  const parent = await prisma.category.create({ data: { name: `Kuchyn-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Zidle-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({ data: { name: `Zidle-${stamp}`, categoryId: child.id, unit: "ks" } });
  await prisma.inventoryLedger.create({
    data: { inventoryItemId: item.id, deltaQuantity: stock, reason: LedgerReason.audit_adjustment, createdById: user.id }
  });
  const event = await prisma.event.create({
    data: {
      name: `Trojdenni-${stamp}`,
      location: "L",
      deliveryDatetime: new Date("2030-08-01T06:00:00Z"),
      pickupDatetime: new Date("2030-08-03T18:00:00Z"),
      status: EventStatus.READY_FOR_WAREHOUSE,
      createdById: user.id
    }
  });
  const reserve = (items: Array<{ qty: number; dayFrom?: number; dayTo?: number | null }>) =>
    prisma.$transaction((tx) =>
      reserveItemsTx({
        tx,
        actor: { id: user.id, role: Role.admin },
        eventId: event.id,
        items: items.map((i) => ({ inventoryItemId: item.id, ...i }))
      })
    );
  const rows = () =>
    prisma.eventReservation.findMany({
      where: { eventId: event.id },
      orderBy: [{ dayFrom: "asc" }, { reservedQuantity: "asc" }],
      select: { dayFrom: true, dayTo: true, reservedQuantity: true }
    });
  return { reserve, rows };
}

describe("rezervace po dnech (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("stejná položka může mít víc řádků s různými dny", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 150);
    await f.reserve([{ qty: 50 }]);
    await f.reserve([{ qty: 70, dayFrom: 2, dayTo: 2 }]);

    expect(await f.rows()).toEqual([
      { dayFrom: 1, dayTo: null, reservedQuantity: 50 },
      { dayFrom: 2, dayTo: 2, reservedQuantity: 70 }
    ]);
    await disconnect();
  });

  maybe("rozsah do posledního dne se uloží jako do konce akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 10);
    await f.reserve([{ qty: 5, dayFrom: 2, dayTo: 3 }]);

    expect(await f.rows()).toEqual([{ dayFrom: 2, dayTo: null, reservedQuantity: 5 }]);
    await disconnect();
  });

  maybe("druhý řádek téže akce nepřekročí sklad", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 100);
    await f.reserve([{ qty: 60 }]);

    const err = await f.reserve([{ qty: 50, dayFrom: 2, dayTo: 2 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientStockError);
    expect((err as InsufficientStockError).available).toBe(40);
    await disconnect();
  });

  maybe("dva řádky v jednom požadavku se kontrolují postupně", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 100);

    await expect(f.reserve([{ qty: 60 }, { qty: 50, dayFrom: 2, dayTo: 2 }])).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await f.rows()).toEqual([]);
    await disconnect();
  });

  maybe("qty 0 smaže jen řádek daného rozsahu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 150);
    await f.reserve([{ qty: 50 }, { qty: 70, dayFrom: 2, dayTo: 2 }]);
    await f.reserve([{ qty: 0, dayFrom: 2, dayTo: 2 }]);

    expect(await f.rows()).toEqual([{ dayFrom: 1, dayTo: null, reservedQuantity: 50 }]);
    await disconnect();
  });

  maybe("neplatný rozsah a duplicitní řádek se odmítnou", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 10);

    await expect(f.reserve([{ qty: 1, dayFrom: 4 }])).rejects.toThrow("INVALID_DAY_RANGE");
    await expect(f.reserve([{ qty: 1, dayFrom: 3, dayTo: 2 }])).rejects.toThrow("INVALID_DAY_RANGE");
    // dayTo 3 = do konce akce, tedy stejný řádek jako bez dayTo.
    await expect(f.reserve([{ qty: 1 }, { qty: 2, dayFrom: 1, dayTo: 3 }])).rejects.toThrow("DUPLICATE_ITEMS");
    await disconnect();
  });
});
```

- [ ] **Step 2: Spusť testy, musí spadnout**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/reserveDays.integration.test.ts`
Expected: FAIL (typová chyba `dayFrom` v items nebo `eventId_inventoryItemId` neexistuje).

- [ ] **Step 3: Přepiš `src/services/reserve.ts`**

```ts
import type { Role, Prisma } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemsTx } from "./availability.js";
import { dayRangeKey, normalizeDayRange } from "../lib/eventDays.js";

export class InsufficientStockError extends Error {
  constructor(
    public inventoryItemId: string,
    public available: number
  ) {
    super("INSUFFICIENT_STOCK");
  }
}

/// Řádek rezervace. Bez dayFrom/dayTo platí pro celou akci.
export type ReserveItemInput = { inventoryItemId: string; qty: number; dayFrom?: number; dayTo?: number | null };

export async function reserveItemsTx(params: {
  tx: Prisma.TransactionClient;
  actor: { id: string; role: Role };
  eventId: string;
  items: ReserveItemInput[];
}) {
  const { tx, actor, eventId, items } = params;

  const [event] = await tx.$queryRaw<{ id: string; status: string; export_needs_revision: boolean; day_count: number }[]>`
    SELECT id, status::text, export_needs_revision,
           event_day_count(delivery_datetime, pickup_datetime)::int AS day_count
    FROM events
    WHERE id = ${eventId}::uuid
    FOR UPDATE
  `;
  if (!event) throw new Error("EVENT_NOT_FOUND");
  if (event.status === "ISSUED" || event.status === "CLOSED" || event.status === "CANCELLED") {
    throw new Error("EVENT_READ_ONLY");
  }

  // Rozsah se sjednotí dřív, než se hledají duplicity: „dny 1 až 3“ u třídenní
  // akce je tentýž řádek jako „celá akce“.
  const rows = items.map((item) => {
    const range = normalizeDayRange({ dayFrom: item.dayFrom, dayTo: item.dayTo }, Number(event.day_count));
    if (!range) throw new Error("INVALID_DAY_RANGE");
    return {
      inventoryItemId: item.inventoryItemId,
      qty: item.qty,
      range,
      key: `${item.inventoryItemId}|${dayRangeKey(range)}`
    };
  });
  if (new Set(rows.map((r) => r.key)).size !== rows.length) throw new Error("DUPLICATE_ITEMS");

  const itemIds = Array.from(new Set(rows.map((r) => r.inventoryItemId)));

  // 1. Check Role Category Access
  if (actor.role !== "admin") {
    const allowedAccess = await tx.roleCategoryAccess.findMany({
      where: { role: actor.role },
      select: { categoryId: true }
    });

    // Empty role config means unrestricted access for that role.
    // Restrictions only apply once admin explicitly assigns categories.
    if (allowedAccess.length > 0) {
      const allowedCategoryIds = new Set(allowedAccess.map((a) => a.categoryId));

      const itemCats = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, categoryId: true, category: { select: { parentId: true } } }
      });

      for (const item of itemCats) {
        const isAllowed =
          allowedCategoryIds.has(item.categoryId) ||
          (item.category.parentId && allowedCategoryIds.has(item.category.parentId));

        if (!isAllowed) {
          throw new Error("CATEGORY_ACCESS_DENIED");
        }
      }
    }
  }

  // 2. Master Package roundup — adjust quantities to full master packages
  const itemIdsForLookup = rows.filter((r) => r.qty > 0).map((r) => r.inventoryItemId);
  const masterPackageItems = itemIdsForLookup.length > 0
    ? await tx.inventoryItem.findMany({
        where: { id: { in: itemIdsForLookup }, masterPackageQty: { not: null } },
        select: { id: true, masterPackageQty: true }
      })
    : [];
  const masterPackageMap = new Map(masterPackageItems.map((i) => [i.id, i.masterPackageQty!]));

  const adjustedRows = rows.map((row) => {
    if (row.qty <= 0) return { ...row, originalQty: row.qty };
    const mpq = masterPackageMap.get(row.inventoryItemId);
    if (mpq && mpq > 0) {
      return { ...row, originalQty: row.qty, qty: Math.ceil(row.qty / mpq) * mpq };
    }
    return { ...row, originalQty: row.qty };
  });

  for (const inventoryItemId of [...itemIds].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2025, hashtext(${inventoryItemId}))`;
  }

  const existingReservations = await tx.eventReservation.findMany({
    where: { eventId, inventoryItemId: { in: itemIds } },
    select: { id: true, inventoryItemId: true, dayFrom: true, dayTo: true, createdById: true, reservedQuantity: true }
  });
  const existingByKey = new Map(
    existingReservations.map((r) => [`${r.inventoryItemId}|${dayRangeKey({ dayFrom: r.dayFrom, dayTo: r.dayTo })}`, r])
  );

  const now = new Date();
  const expiresAt =
    event.status === "DRAFT" ? new Date(now.getTime() + 30 * 60 * 1000) : null;
  const state = event.status === "DRAFT" ? "draft" : "confirmed";

  // Řádky se kontrolují a zapisují postupně, aby druhý řádek téže položky
  // v jednom požadavku viděl první a dohromady nepřekročily sklad.
  for (const row of adjustedRows) {
    const existing = existingByKey.get(row.key);

    if (row.qty <= 0) {
      if (existing) await tx.eventReservation.delete({ where: { id: existing.id } });
      continue;
    }

    const [availability] = await getAvailabilityForEventItemsTx(tx, eventId, [row.inventoryItemId], { range: row.range });
    const available = availability?.available ?? 0;
    if (row.qty > available) throw new InsufficientStockError(row.inventoryItemId, available);

    if (existing) {
      await tx.eventReservation.update({
        where: { id: existing.id },
        data: { reservedQuantity: row.qty, state, expiresAt, createdById: existing.createdById ?? actor.id }
      });
    } else {
      await tx.eventReservation.create({
        data: {
          eventId,
          inventoryItemId: row.inventoryItemId,
          reservedQuantity: row.qty,
          dayFrom: row.range.dayFrom,
          dayTo: row.range.dayTo,
          state,
          expiresAt,
          createdById: actor.id
        }
      });
    }
  }

  if (event.status === "SENT_TO_WAREHOUSE") {
    await tx.event.update({ where: { id: eventId }, data: { exportNeedsRevision: true } });

    // Sklad uz ma balenu v ruce, takze se musi dozvedet, co se v ni zmenilo -
    // ktera polozka, na ktere dny a z kolika na kolik. Priznak exportNeedsRevision
    // sam o sobe rekne jen "neco se stalo".
    const changes = adjustedRows
      .map((row) => ({
        inventoryItemId: row.inventoryItemId,
        dayFrom: row.range.dayFrom,
        dayTo: row.range.dayTo,
        from: existingByKey.get(row.key)?.reservedQuantity ?? 0,
        to: Math.max(0, row.qty)
      }))
      .filter((c) => c.from !== c.to);

    if (changes.length > 0) {
      const names = await tx.inventoryItem.findMany({
        where: { id: { in: changes.map((c) => c.inventoryItemId) } },
        select: { id: true, name: true, unit: true }
      });
      const metaById = new Map(names.map((n) => [n.id, n] as const));
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "event",
          entityId: eventId,
          action: "packing_changed",
          diffJson: {
            changes: changes.map((c) => ({
              ...c,
              name: metaById.get(c.inventoryItemId)?.name ?? c.inventoryItemId,
              unit: metaById.get(c.inventoryItemId)?.unit ?? "ks"
            }))
          }
        }
      });
    }
  }

  // Return adjusted items info so the caller can inform the user about roundups
  const masterPackageAdjustments = adjustedRows
    .filter((r) => r.originalQty !== r.qty && r.qty > 0)
    .map((r) => ({
      inventoryItemId: r.inventoryItemId,
      dayFrom: r.range.dayFrom,
      dayTo: r.range.dayTo,
      requestedQty: r.originalQty,
      adjustedQty: r.qty,
      masterPackageQty: masterPackageMap.get(r.inventoryItemId) ?? null
    }));

  return { state, expiresAt, masterPackageAdjustments };
}
```

Pozn.: mazání řádku (`qty 0`) dostupnost nekontroluje. Dřív ji kontrolovalo a u přeplněné akce šlo odebrání položky zablokovat, což nedává smysl.

- [ ] **Step 4: Rozšiř routu `POST /events/:id/reserve`**

V `src/routes/events.ts` ve schématu položek přidej:

```ts
            z.object({
              inventory_item_id: z.string().uuid(),
              qty: z.number().int().min(0),
              day_from: z.number().int().min(1).optional(),
              day_to: z.number().int().min(1).nullable().optional()
            })
```

Volání služby:

```ts
          items: body.items.map((i) => ({
            inventoryItemId: i.inventory_item_id,
            qty: i.qty,
            dayFrom: i.day_from,
            dayTo: i.day_to
          }))
```

Do `catch` přidej před `EVENT_NOT_FOUND`:

```ts
      if (e?.message === "INVALID_DAY_RANGE") {
        return httpError(reply, 400, "INVALID_DAY_RANGE", "Neplatný rozsah dnů akce.");
      }
```

a u `DUPLICATE_ITEMS` změň text na `"Každá položka může být v jednom vložení jen jednou pro daný rozsah dnů."`.

- [ ] **Step 5: `packing-changes` předává dny**

V `GET /events/:id/packing-changes` rozšiř typ a mapování:

```ts
      const diff = entry.diffJson as {
        changes?: Array<{ name: string; unit: string; from: number; to: number; dayFrom?: number; dayTo?: number | null }>;
      } | null;
      ...
      return (diff?.changes ?? []).map((c) => ({
        name: c.name,
        unit: c.unit,
        from: c.from,
        to: c.to,
        dayFrom: c.dayFrom ?? 1,
        dayTo: c.dayTo ?? null,
        changedBy: actorLabel,
        changedAt: entry.createdAt.toISOString()
      }));
```

- [ ] **Step 6: Spusť testy rezervací**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/reserveDays.integration.test.ts test/reserve.integration.test.ts`
Expected: PASS. Pokud `reserve.integration.test.ts` používá `eventId_inventoryItemId`, nahraď v testu hledání přes `findFirst({ where: { eventId, inventoryItemId } })`.

Run: `grep -rn "eventId_inventoryItemId" apps/api/src apps/api/test`
Expected: zbývají jen výskyty u balení v `src/routes/events.ts` (opraví Task 6).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/reserve.ts apps/api/src/routes/events.ts apps/api/test/reserveDays.integration.test.ts apps/api/test/reserve.integration.test.ts
git commit -m "Umožni rezervovat položku na zvolené dny akce"
```

---

### Task 4: Změna termínu akce zkrátí řádky

**Files:**
- Create: `apps/api/src/services/eventDayChange.ts`
- Modify: `apps/api/src/routes/events.ts` (`PATCH /events/:id`)
- Test: `apps/api/test/eventDayChange.integration.test.ts`

**Interfaces:**
- Consumes: `eventDayCount` z `src/lib/eventDays.ts`.
- Produces: `fitReservationsToDayCountTx(tx, eventId: string, dayCount: number): Promise<{ changed: boolean }>`. Vyhodí `Error("DAYS_OUT_OF_RANGE")` s vlastností `itemNames: string[]`.

- [ ] **Step 1: Napiš padající testy**

`apps/api/test/eventDayChange.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStatus, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { fitReservationsToDayCountTx } from "../src/services/eventDayChange.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({ data: { email: `daychg-${stamp}@local`, passwordHash: "x", role: Role.admin } });
  const parent = await prisma.category.create({ data: { name: `Inv-chg-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Sub-chg-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({ data: { name: `Ubrus-${stamp}`, categoryId: child.id, unit: "ks" } });
  const event = await prisma.event.create({
    data: {
      name: `Chg-${stamp}`,
      location: "L",
      deliveryDatetime: new Date("2030-09-01T06:00:00Z"),
      pickupDatetime: new Date("2030-09-03T18:00:00Z"),
      status: EventStatus.DRAFT,
      createdById: user.id
    }
  });
  const add = (qty: number, dayFrom: number, dayTo: number | null) =>
    prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: qty, state: "confirmed", dayFrom, dayTo }
    });
  const rows = () =>
    prisma.eventReservation.findMany({
      where: { eventId: event.id },
      orderBy: [{ dayFrom: "asc" }, { reservedQuantity: "asc" }],
      select: { dayFrom: true, dayTo: true, reservedQuantity: true }
    });
  return { event, item, add, rows };
}

describe("zkrácení vícedenní akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("řádek končící za novým posledním dnem se zkrátí a sloučí", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 1, 2);
    await f.add(3, 1, 1);

    const res = await prisma.$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 2));

    expect(res.changed).toBe(true);
    expect(await f.rows()).toEqual([
      { dayFrom: 1, dayTo: 1, reservedQuantity: 3 },
      { dayFrom: 1, dayTo: null, reservedQuantity: 15 }
    ]);
    await disconnect();
  });

  maybe("řádek, který by celý vypadl z akce, zamítne změnu termínu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(4, 3, null);

    const err = await prisma
      .$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 2))
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe("DAYS_OUT_OF_RANGE");
    expect((err as Error & { itemNames?: string[] }).itemNames).toEqual([f.item.name]);
    expect(await f.rows()).toEqual([{ dayFrom: 3, dayTo: null, reservedQuantity: 4 }]);
    await disconnect();
  });

  maybe("prodloužení akce řádky nemění", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 2, 2);

    const res = await prisma.$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 5));
    expect(res.changed).toBe(false);
    expect(await f.rows()).toEqual([
      { dayFrom: 1, dayTo: null, reservedQuantity: 10 },
      { dayFrom: 2, dayTo: 2, reservedQuantity: 5 }
    ]);
    await disconnect();
  });
});
```

- [ ] **Step 2: Spusť, musí spadnout**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/eventDayChange.integration.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Implementuj `src/services/eventDayChange.ts`**

```ts
import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Po změně termínu přizpůsobí řádky rezervací nové délce akce.
 *
 * Řádek končící na novém posledním dni nebo za ním se zkrátí na „do konce
 * akce“ a sečte se s případným řádkem stejného rozsahu. Řádek, který by
 * celý vypadl mimo akci, se nepřesouvá: EM ho musí vyřešit sám, jinak by
 * zboží tiše zmizelo z plánu nebo se přesunulo na jiný den.
 */
export async function fitReservationsToDayCountTx(
  tx: Prisma.TransactionClient,
  eventId: string,
  dayCount: number
): Promise<{ changed: boolean }> {
  const rows = await tx.eventReservation.findMany({
    where: { eventId },
    select: {
      id: true,
      inventoryItemId: true,
      dayFrom: true,
      dayTo: true,
      reservedQuantity: true,
      item: { select: { name: true } }
    }
  });

  const outside = rows.filter((r) => r.dayFrom > dayCount);
  if (outside.length > 0) {
    const err = new Error("DAYS_OUT_OF_RANGE") as Error & { itemNames?: string[] };
    err.itemNames = Array.from(new Set(outside.map((r) => r.item.name)));
    throw err;
  }

  const toTrim = rows.filter((r) => r.dayTo !== null && r.dayTo >= dayCount);
  for (const row of toTrim) {
    const target = rows.find(
      (r) => r.id !== row.id && r.inventoryItemId === row.inventoryItemId && r.dayFrom === row.dayFrom && r.dayTo === null
    );
    if (target) {
      await tx.eventReservation.update({
        where: { id: target.id },
        data: { reservedQuantity: target.reservedQuantity + row.reservedQuantity }
      });
      target.reservedQuantity += row.reservedQuantity;
      await tx.eventReservation.delete({ where: { id: row.id } });
      row.reservedQuantity = 0;
    } else {
      await tx.eventReservation.update({ where: { id: row.id }, data: { dayTo: null } });
      row.dayTo = null;
    }
  }

  if (toTrim.length > 0) {
    // Stav balení se váže na klíč řádku. U změněných řádků ho skladník projde znovu.
    await tx.eventPacking.deleteMany({ where: { eventId, dayTo: { gte: dayCount } } });
  }

  return { changed: toTrim.length > 0 };
}
```

- [ ] **Step 4: Zapoj do `PATCH /events/:id`**

V `src/routes/events.ts` přidej importy:

```ts
import { eventDayCount } from "../lib/eventDays.js";
import { fitReservationsToDayCountTx } from "../services/eventDayChange.js";
```

V handleru `PATCH /events/:id` nahraď příkaz `const event = await app.prisma.event.update({ ... });` tímto:

```ts
    let event;
    try {
      event = await app.prisma.$transaction(async (tx) => {
        const { changed } = await fitReservationsToDayCountTx(tx, params.id, eventDayCount(nextDelivery, nextPickup));
        return tx.event.update({
          where: { id: params.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.location !== undefined ? { location: body.location } : {}),
            ...(body.address !== undefined ? { address: body.address } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.registration_number !== undefined ? { registrationNumber: body.registration_number } : {}),
            ...(body.event_date !== undefined ? { eventDate: body.event_date ? new Date(body.event_date) : null } : {}),
            ...(body.delivery_datetime !== undefined ? { deliveryDatetime: new Date(body.delivery_datetime) } : {}),
            ...(body.pickup_datetime !== undefined ? { pickupDatetime: new Date(body.pickup_datetime) } : {}),
            // Zkrácené řádky mění balení, sklad musí dostat nový export.
            ...(changed && existing.status === "SENT_TO_WAREHOUSE" ? { exportNeedsRevision: true } : {})
          }
        });
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "DAYS_OUT_OF_RANGE") {
        const names = (e as Error & { itemNames?: string[] }).itemNames ?? [];
        return httpError(
          reply,
          409,
          "DAYS_OUT_OF_RANGE",
          `Tyto položky jsou naplánované na dny, které po změně termínu v akci nebudou: ${names.join(", ")}. Uprav je nejdřív.`
        );
      }
      throw e;
    }
```

- [ ] **Step 5: Spusť testy**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/eventDayChange.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/eventDayChange.ts apps/api/src/routes/events.ts apps/api/test/eventDayChange.integration.test.ts
git commit -m "Při zkrácení akce zkrať řádky položek na nový poslední den"
```

---

### Task 5: Export, PDF po dnech a detail akce

**Files:**
- Modify: `apps/api/src/pdf/exportPdf.ts` (typ `ExportSnapshot`, nové helpery, vykreslení názvu položky)
- Modify: `apps/api/src/services/export.ts`
- Modify: `apps/api/src/routes/events.ts` (`GET /events/:id`, `GET /events/:id/exports/:version/pdf`, `GET /events/:id/export-preview`)
- Test: `apps/api/test/exportPdf.test.ts` (doplnit), `apps/api/test/exportDays.integration.test.ts`

**Interfaces:**
- Produces (`exportPdf.ts`): položky snapshotu mají `dayFrom?: number; dayTo?: number | null`, `snapshot.event.dayCount?: number`; `itemDayFrom(item): number`, `dayTagLabel(item, dayCount): string | null`, `filterSnapshotToDay(snapshot, day): ExportSnapshot`.
- Produces (API): `GET /events/:id` vrací navíc `event.dayCount: number` a `event.issuedDays: number[]`; `warehouseItems` ze snapshotu jsou sečtené po položkách. PDF přijímá `?day=N`. Náhled exportu má u položek `dayFrom`, `dayTo` a `event.dayCount`.
- Consumes: `getIssuedDaysTx` z Task 6. **Pořadí:** Task 5 potřebuje `getIssuedDaysTx`, proto ji v kroku 6 tohoto tasku vytvoř v `src/services/issueDay.ts` (Task 6 soubor rozšíří).

- [ ] **Step 1: Napiš padající unit testy PDF**

V `apps/api/test/exportPdf.test.ts` rozšiř import na začátku souboru na `import { buildExportPdf, dayTagLabel, filterSnapshotToDay, type ExportSnapshot } from "../src/pdf/exportPdf.js";` a na konec souboru přidej:

```ts
describe("vícedenní export", () => {
  const multi: ExportSnapshot = {
    ...snapshot([
      { inventoryItemId: "a", name: "Židle", unit: "ks", qty: 50, dayFrom: 1, dayTo: null },
      { inventoryItemId: "a", name: "Židle", unit: "ks", qty: 70, dayFrom: 2, dayTo: 2 },
      { inventoryItemId: "b", name: "Ubrus", unit: "ks", qty: 10 }
    ]),
  };
  multi.event.dayCount = 3;

  it("PDF dne obsahuje jen řádky, které ten den odjíždějí", () => {
    const day2 = filterSnapshotToDay(multi, 2);
    expect(day2.groups.flatMap((g) => g.items).map((i) => i.qty)).toEqual([70]);
    const day1 = filterSnapshotToDay(multi, 1);
    // Starý řádek bez dayFrom patří do dne 1.
    expect(day1.groups.flatMap((g) => g.items).map((i) => i.qty)).toEqual([50, 10]);
    expect(filterSnapshotToDay(multi, 3).groups).toEqual([]);
  });

  it("štítek dnů se tiskne jen u vícedenní akce", () => {
    expect(dayTagLabel({ dayFrom: 2, dayTo: 2 }, 3)).toBe("den 2");
    expect(dayTagLabel({ dayFrom: 1, dayTo: null }, 3)).toBe("cela akce");
    expect(dayTagLabel({ dayFrom: 2, dayTo: null }, 3)).toBe("dny 2-3");
    expect(dayTagLabel({}, 1)).toBeNull();
  });

  it("vícedenní snapshot se vykreslí", async () => {
    const pdf = await buildExportPdf(multi);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
});
```

Run: `cd apps/api && npx vitest run test/exportPdf.test.ts`
Expected: FAIL, `dayTagLabel` a `filterSnapshotToDay` neexistují.

- [ ] **Step 2: Rozšiř `src/pdf/exportPdf.ts`**

V typu `ExportSnapshot` přidej do `event` pole `dayCount?: number;` (komentář `/// Chybí u exportů před zavedením vícedenních akcí = 1 den.`) a do položek:

```ts
      /// Rozsah dnů řádku. Chybí u exportů před zavedením vícedenních akcí = celá akce.
      dayFrom?: number;
      dayTo?: number | null;
```

Pod funkci `wrapText` přidej:

```ts
/// Den, kdy řádek odjíždí ze skladu. Starší snapshoty rozsah nemají = den 1.
export function itemDayFrom(item: { dayFrom?: number }): number {
  return item.dayFrom ?? 1;
}

export function dayTagLabel(item: { dayFrom?: number; dayTo?: number | null }, dayCount: number): string | null {
  if (dayCount <= 1) return null;
  const from = item.dayFrom ?? 1;
  const to = item.dayTo ?? dayCount;
  if (from === 1 && to === dayCount) return "cela akce";
  return from === to ? `den ${from}` : `dny ${from}-${to}`;
}

/// Balicí seznam jednoho dne: jen řádky, které ten den odjíždějí ze skladu.
export function filterSnapshotToDay(snapshot: ExportSnapshot, day: number): ExportSnapshot {
  return {
    ...snapshot,
    groups: snapshot.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => itemDayFrom(i) === day) }))
      .filter((g) => g.items.length > 0)
  };
}
```

V `buildExportPdf` v cyklu `for (const item of group.items)` nahraď vykreslení názvu a výpočet jeho šířky:

```ts
        // U vícedenní akce se u položky tiskne, na které dny patří.
        const dayTag = dayTagLabel(item, snapshot.event.dayCount ?? 1);
        const itemLabel = dayTag ? `${item.name} [${dayTag}]` : item.name;

        // Item Name
        page.drawText(pdfText(itemLabel), { x: colName, y: yPos, size: 10, font });
```

a v bloku skladu `const nameWidth = font.widthOfTextAtSize(pdfText(item.name), 10);` změň na `pdfText(itemLabel)`.

Run: `cd apps/api && npx vitest run test/exportPdf.test.ts`
Expected: PASS.

- [ ] **Step 3: Napiš padající integrační test exportu**

`apps/api/test/exportDays.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStatus, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createExportTx } from "../src/services/export.js";

describe("export vícedenní akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("snapshot nese dny řádků a počet dnů akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const stamp = fixtureStamp();
    const user = await prisma.user.create({ data: { email: `expd-${stamp}@local`, passwordHash: "x", role: Role.admin } });
    const parent = await prisma.category.create({ data: { name: `Kuchyn-exp-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Zidle-exp-${stamp}`, parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: `Zidle-${stamp}`, categoryId: child.id, unit: "ks" } });
    const event = await prisma.event.create({
      data: {
        name: `Exp-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2030-10-01T06:00:00Z"),
        pickupDatetime: new Date("2030-10-03T16:00:00Z"),
        status: EventStatus.READY_FOR_WAREHOUSE,
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 70, state: "confirmed", dayFrom: 2, dayTo: 2 }
    });
    await prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 50, state: "confirmed" }
    });

    const { snapshot } = await prisma.$transaction((tx) => createExportTx({ tx, eventId: event.id, userId: user.id }));

    expect(snapshot.event.dayCount).toBe(3);
    const rows = snapshot.groups.flatMap((g) => g.items).map((i) => [i.qty, i.dayFrom, i.dayTo]);
    expect(rows).toEqual([
      [50, 1, null],
      [70, 2, 2]
    ]);
    await disconnect();
  });
});
```

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/exportDays.integration.test.ts`
Expected: FAIL (`dayCount` undefined).

- [ ] **Step 4: Uprav `src/services/export.ts`**

1. Do SQL výběru akce přidej sloupec a do typu výsledku `day_count: number;`:

```sql
    SELECT e.id, e.name, e.location, e.address, e.notes, e.event_date, e.delivery_datetime, e.pickup_datetime, e.status::text,
           event_day_count(e.delivery_datetime, e.pickup_datetime)::int AS day_count,
           u.name as manager_name, u.email as manager_email, u.id as manager_id
```

2. `orderBy` u načtení rezervací změň na `orderBy: [{ inventoryItemId: "asc" }, { dayFrom: "asc" }]`.
3. Do `group.items.push({ ... })` přidej `dayFrom: r.dayFrom, dayTo: r.dayTo,`.
4. Řazení položek ve skupině: `items: g.items.sort((a, b) => a.name.localeCompare(b.name, "cs") || (a.dayFrom ?? 1) - (b.dayFrom ?? 1))`.
5. Do `snapshot.event` přidej `dayCount: Number(ev.day_count),`.

Run: stejný příkaz jako ve Step 3. Expected: PASS.

- [ ] **Step 5: PDF route přijme `?day=N`**

V `GET /events/:id/exports/:version/pdf`:

```ts
    const queryParams = z
      .object({ type: z.enum(["general", "kitchen"]).optional(), day: z.coerce.number().int().min(1).optional() })
      .parse(request.query);
```

`const snapshot = JSON.parse(...)` změň na `let snapshot = ...`. Za blok s `queryParams.type` přidej:

```ts
    if (queryParams.day) {
      snapshot = filterSnapshotToDay(snapshot, queryParams.day);
      subtitle = subtitle ? `${subtitle} - Den ${queryParams.day}` : `Den ${queryParams.day}`;
    }
```

a název souboru:

```ts
      const typeSuffix = queryParams.type ? `_${queryParams.type === "kitchen" ? "kuchyn" : "sklad"}` : "";
      const daySuffix = queryParams.day ? `_den${queryParams.day}` : "";
      reply.header("Content-Disposition", `inline; filename="event_${snapshot.event.id}_v${snapshot.event.version}${typeSuffix}${daySuffix}.pdf"`);
```

(nahrazuje dosavadní `filenameSuffix`). Import doplň: `import { buildExportPdf, filterSnapshotToDay, type ExportSnapshot } from "../pdf/exportPdf.js";`.

- [ ] **Step 6: `getIssuedDaysTx` a detail akce**

Vytvoř `apps/api/src/services/issueDay.ts` zatím jen s touto funkcí (Task 6 soubor rozšíří):

```ts
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

/**
 * Dny akce, jejichž plánovaný výdej už proběhl. Doplňkový výdej nemá rozsah
 * (day_from NULL) a vydaný den nevytváří.
 */
export async function getIssuedDaysTx(
  db: Prisma.TransactionClient | PrismaClient,
  eventId: string
): Promise<number[]> {
  const rows = await db.eventIssue.findMany({
    where: { eventId, type: "issued", dayFrom: { not: null } },
    distinct: ["dayFrom"],
    select: { dayFrom: true },
    orderBy: { dayFrom: "asc" }
  });
  return rows.flatMap((r) => (r.dayFrom === null ? [] : [r.dayFrom]));
}
```

V `GET /events/:id` (routa v `events.ts`) nahraď blok `if (warehouseItems.length === 0 && snapshot?.groups?.length) { ... }` a `return`:

```ts
    if (warehouseItems.length === 0 && snapshot?.groups?.length) {
      // Vícedenní akce má v exportu víc řádků jedné položky. Seznam skladu
      // ukazuje součet, po dnech se balí v kartě „Balení po dnech“.
      const byItemId = new Map<string, (typeof warehouseItems)[number]>();
      for (const g of snapshot.groups) {
        for (const it of g.items ?? []) {
          const existing = byItemId.get(it.inventoryItemId);
          if (existing) {
            existing.qty += it.qty;
            continue;
          }
          byItemId.set(it.inventoryItemId, {
            inventoryItemId: it.inventoryItemId,
            name: it.name,
            unit: it.unit,
            qty: it.qty,
            parentCategory: g.parentCategory,
            category: (g as { category?: string }).category,
            warehouseName: it.warehouseName,
            warehouseIsHome: it.warehouseIsHome
          });
        }
      }
      warehouseItems = Array.from(byItemId.values());
    }

    const dayCount = eventDayCount(event.deliveryDatetime, event.pickupDatetime);
    const issuedDays = await getIssuedDaysTx(app.prisma, event.id);

    return { event: { ...event, exports, warehouseItems, dayCount, issuedDays } };
```

Import: `import { getIssuedDaysTx } from "../services/issueDay.js";`.

- [ ] **Step 7: Náhled exportu nese dny**

V `GET /events/:id/export-preview`:
- typ položek skupiny: `items: Array<{ name: string; qty: number; unit: string; dayFrom: number; dayTo: number | null }>;`
- `group.items.push({ name: r.item.name, qty: r.reservedQuantity, unit: r.item.unit, dayFrom: r.dayFrom, dayTo: r.dayTo });`
- řazení: `items: group.items.sort((a, b) => a.name.localeCompare(b.name, "cs") || a.dayFrom - b.dayFrom)`
- do `preview.event` přidej `dayCount: eventDayCount(ev.deliveryDatetime, ev.pickupDatetime)`.

- [ ] **Step 8: Typecheck a testy**

Run: `cd apps/api && npx tsc -p tsconfig.typecheck.json`
Expected: chyby už jen u balení (`eventId_inventoryItemId`), ty řeší Task 6.

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/exportPdf.test.ts test/exportDays.integration.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/pdf/exportPdf.ts apps/api/src/services/export.ts apps/api/src/services/issueDay.ts apps/api/src/routes/events.ts apps/api/test/exportPdf.test.ts apps/api/test/exportDays.integration.test.ts
git commit -m "Přidej dny do exportu, PDF na jeden den a počet dnů do detailu akce"
```

---

### Task 6: Výdej a balení po dnech

**Files:**
- Modify: `apps/api/src/services/issueDay.ts` (doplnit `issueDayTx`)
- Modify: `apps/api/src/routes/events.ts` (`POST /events/:id/issue`, `GET` a `PUT /events/:id/packing`, nepoužité importy)
- Test: `apps/api/test/issueDay.integration.test.ts`

**Interfaces:**
- Consumes: `getIssuedDaysTx` (Task 5), `ExportSnapshot`, `itemDayFrom` (Task 5), `createExportTx`, `issueAdditionalTx`, `returnCloseTx`.
- Produces: `type IssueDayItemInput = { inventory_item_id: string; issued_quantity: number; day_to?: number | null; warehouse_id?: string; idempotency_key?: string }`, `issueDayTx({ tx, eventId, userId, day, idempotencyKey?, warehouseId?, palletCount?, items? })` vrací `{ event, skippedItems, alreadyIssued: boolean }`. Chyby: `NOT_FOUND`, `READ_ONLY`, `BAD_STATUS`, `NEEDS_REVISION`, `NO_EXPORT`, `INVALID_DAY`, `NO_ITEMS_TO_ISSUE`, `DUPLICATE_ITEMS`, `WAREHOUSE_REQUIRED` (s `itemNames`).
- API: `POST /events/:id/issue` přijímá `day` (výchozí 1) a u položek `day_to`. `GET /events/:id/packing` vrací `{ inventoryItemId, dayFrom, dayTo, state }`. `PUT /events/:id/packing` přijímá `day_from`, `day_to`.

- [ ] **Step 1: Napiš padající testy**

`apps/api/test/issueDay.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role, type Prisma } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createExportTx } from "../src/services/export.js";
import { getPhysicalTotal } from "../src/services/availability.js";
import { getIssuedDaysTx, issueDayTx } from "../src/services/issueDay.js";
import { issueAdditionalTx } from "../src/services/issueAdditional.js";
import { returnCloseTx } from "../src/services/returnClose.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma, opts: { days: 1 | 3 }) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({ data: { email: `issday-${stamp}@local`, passwordHash: "x", role: Role.admin } });
  const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-issday-${stamp}` } });
  const parent = await prisma.category.create({ data: { name: `Kuchyn-issday-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Zidle-issday-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({
    data: { name: `Zidle-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
  });
  await prisma.inventoryLedger.create({
    data: {
      inventoryItemId: item.id,
      deltaQuantity: 200,
      reason: LedgerReason.audit_adjustment,
      warehouseId: warehouse.id,
      createdById: user.id
    }
  });
  const event = await prisma.event.create({
    data: {
      name: `Issday-${stamp}`,
      location: "L",
      deliveryDatetime: new Date("2030-11-05T07:00:00Z"),
      pickupDatetime: new Date(opts.days === 3 ? "2030-11-07T17:00:00Z" : "2030-11-05T17:00:00Z"),
      status: EventStatus.READY_FOR_WAREHOUSE,
      createdById: user.id
    }
  });
  await prisma.eventReservation.create({
    data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 50, state: "confirmed" }
  });
  if (opts.days === 3) {
    await prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 70, state: "confirmed", dayFrom: 2, dayTo: 2 }
    });
  }
  await prisma.$transaction((tx) => createExportTx({ tx, eventId: event.id, userId: user.id }));

  const issue = (day: number) =>
    prisma.$transaction((tx) => issueDayTx({ tx, eventId: event.id, userId: user.id, day, idempotencyKey: `t-${stamp}` }));
  const issueRows = () =>
    prisma.eventIssue.findMany({
      where: { eventId: event.id, type: "issued" },
      orderBy: { issuedAt: "asc" },
      select: { issuedQuantity: true, dayFrom: true, dayTo: true }
    });
  return { stamp, user, warehouse, item, event, issue, issueRows };
}

describe("výdej po dnech (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("den 1 vydá jen řádky začínající dnem 1 a přepne akci na Vydáno", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });

    const res = await f.issue(1);

    expect(res.alreadyIssued).toBe(false);
    expect(res.event.status).toBe(EventStatus.ISSUED);
    expect(await f.issueRows()).toEqual([{ issuedQuantity: 50, dayFrom: 1, dayTo: null }]);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(150);
    await disconnect();
  });

  maybe("další den jde vydat i ve stavu Vydáno", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);

    await f.issue(2);

    expect(await f.issueRows()).toEqual([
      { issuedQuantity: 50, dayFrom: 1, dayTo: null },
      { issuedQuantity: 70, dayFrom: 2, dayTo: 2 }
    ]);
    expect(await getIssuedDaysTx(prisma, f.event.id)).toEqual([1, 2]);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(80);
    await disconnect();
  });

  maybe("opakovaný výdej téhož dne nic nezapíše", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);

    const again = await f.issue(1);

    expect(again.alreadyIssued).toBe(true);
    expect(await f.issueRows()).toHaveLength(1);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(150);
    await disconnect();
  });

  maybe("den mimo akci se odmítne", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });

    await expect(f.issue(4)).rejects.toThrow("INVALID_DAY");
    await disconnect();
  });

  maybe("výdej dne smaže jen balení toho dne", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await prisma.eventPacking.createMany({
      data: [
        { eventId: f.event.id, inventoryItemId: f.item.id, dayFrom: 1, dayTo: null, state: "confirmed", updatedById: f.user.id },
        { eventId: f.event.id, inventoryItemId: f.item.id, dayFrom: 2, dayTo: 2, state: "confirmed", updatedById: f.user.id }
      ]
    });

    await f.issue(1);

    const left = await prisma.eventPacking.findMany({ where: { eventId: f.event.id }, select: { dayFrom: true } });
    expect(left).toEqual([{ dayFrom: 2 }]);
    await disconnect();
  });

  maybe("doplňkový výdej nevytvoří vydaný den", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);
    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `add-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 5 }]
      })
    );

    expect(await getIssuedDaysTx(prisma, f.event.id)).toEqual([1]);
    await disconnect();
  });

  maybe("starý výdej se bere jako vydaný den 1", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 1 });
    // Stav po migraci: akce vydaná starým kódem má řádky s day_from = 1.
    await prisma.eventIssue.create({
      data: {
        eventId: f.event.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 50,
        type: "issued",
        issuedById: f.user.id,
        warehouseId: f.warehouse.id,
        dayFrom: 1,
        idempotencyKey: `legacy-${f.stamp}`
      }
    });
    await prisma.event.update({ where: { id: f.event.id }, data: { status: EventStatus.ISSUED } });

    const res = await f.issue(1);
    expect(res.alreadyIssued).toBe(true);
    await disconnect();
  });

  maybe("snapshot bez dnů se vydá jako den 1", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 1 });
    // Export vytvořený před nasazením nemá dayFrom/dayTo ani dayCount.
    const latest = await prisma.eventExport.findFirstOrThrow({ where: { eventId: f.event.id }, orderBy: { version: "desc" } });
    const snap = latest.snapshotJson as { event: Record<string, unknown>; groups: Array<{ items: Array<Record<string, unknown>> }> };
    delete snap.event.dayCount;
    for (const g of snap.groups) for (const i of g.items) { delete i.dayFrom; delete i.dayTo; }
    await prisma.eventExport.update({ where: { id: latest.id }, data: { snapshotJson: snap as unknown as Prisma.InputJsonValue } });

    await f.issue(1);
    expect(await f.issueRows()).toEqual([{ issuedQuantity: 50, dayFrom: 1, dayTo: null }]);
    await disconnect();
  });

  maybe("uzavření sečte výdej všech dnů", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);
    await f.issue(2);

    await prisma.$transaction((tx) =>
      returnCloseTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `close-${f.stamp}`,
        items: [{ inventory_item_id: f.item.id, returned_quantity: 120, broken_quantity: 0, target_warehouse_id: f.warehouse.id }]
      })
    );

    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(200);
    await disconnect();
  });
});
```

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/issueDay.integration.test.ts`
Expected: FAIL, `issueDayTx` neexistuje.

- [ ] **Step 2: Doplň `issueDayTx` do `src/services/issueDay.ts`**

Importy na začátek souboru rozšiř na:

```ts
import { LedgerReason, type Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { itemDayFrom, type ExportSnapshot } from "../pdf/exportPdf.js";
import { splitKnownIssueItems, type SkippedIssueItem } from "../lib/issueSelection.js";
import { computeIssuedWeightKg, formatWeightKg } from "./issueWeight.js";
import { createInventoryLedgerEntry } from "./ledger.js";
import { requireWarehouseId, resolveWarehouseId } from "./warehouse.js";
```

a pod `getIssuedDaysTx` přidej:

```ts
export type IssueDayItemInput = {
  inventory_item_id: string;
  issued_quantity: number;
  /// Konec rozsahu řádku. Chybí-li, vezme se ze snapshotu exportu.
  day_to?: number | null;
  warehouse_id?: string;
  idempotency_key?: string;
};

/**
 * Výdej jednoho dne akce: vydá řádky exportu, které ten den odjíždějí ze
 * skladu. Jednodenní akce má jen den 1, takže se chová jako dřív.
 * První výdej jde jen z předané akce a přepne ji na Vydáno, další dny se
 * vydávají z vydané akce.
 */
export async function issueDayTx(params: {
  tx: Prisma.TransactionClient;
  eventId: string;
  userId: string;
  day: number;
  idempotencyKey?: string;
  warehouseId?: string;
  palletCount?: number | null;
  items?: IssueDayItemInput[];
}) {
  const { tx, eventId, userId, day } = params;

  const [ev] = await tx.$queryRaw<{ status: string; export_needs_revision: boolean; day_count: number }[]>`
    SELECT status::text, export_needs_revision,
           event_day_count(delivery_datetime, pickup_datetime)::int AS day_count
    FROM events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (!ev) throw new Error("NOT_FOUND");
  if (ev.status === "CLOSED" || ev.status === "CANCELLED") throw new Error("READ_ONLY");
  if (!Number.isInteger(day) || day < 1 || day > Number(ev.day_count)) throw new Error("INVALID_DAY");

  const issuedDays = await getIssuedDaysTx(tx, eventId);
  if (issuedDays.includes(day)) {
    const existing = await tx.event.findUnique({ where: { id: eventId } });
    if (!existing) throw new Error("NOT_FOUND");
    return { event: existing, skippedItems: [] as SkippedIssueItem[], alreadyIssued: true };
  }
  if (ev.status !== "ISSUED") {
    if (ev.status !== "SENT_TO_WAREHOUSE") throw new Error("BAD_STATUS");
    if (ev.export_needs_revision) throw new Error("NEEDS_REVISION");
  }

  const latest = await tx.eventExport.findFirst({ where: { eventId }, orderBy: { version: "desc" } });
  if (!latest) throw new Error("NO_EXPORT");
  const snapshot = latest.snapshotJson as unknown as ExportSnapshot;

  const dayRows = snapshot.groups.flatMap((g) => g.items ?? []).filter((i) => itemDayFrom(i) === day);
  const snapshotDayToByItemId = new Map(dayRows.map((i) => [i.inventoryItemId, i.dayTo ?? null] as const));

  const candidates: IssueDayItemInput[] =
    params.items && params.items.length > 0
      ? params.items
      : dayRows.map((i) => ({ inventory_item_id: i.inventoryItemId, issued_quantity: i.qty, day_to: i.dayTo ?? null }));

  const itemsToIssue = candidates
    .filter((i) => i.issued_quantity > 0)
    .map((i) => ({
      ...i,
      day_to: i.day_to !== undefined ? i.day_to : (snapshotDayToByItemId.get(i.inventory_item_id) ?? null)
    }));
  if (itemsToIssue.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

  // Duplicitní řádek by se do event_issues zapsal jen jednou (stejný
  // idempotency_key), ale ze skladu by se odečetl za každý řádek zvlášť.
  const keys = itemsToIssue.map((i) => `${i.inventory_item_id}|${i.day_to ?? "end"}`);
  if (new Set(keys).size !== keys.length) throw new Error("DUPLICATE_ITEMS");

  const inventoryItems = await tx.inventoryItem.findMany({
    where: { id: { in: itemsToIssue.map((i) => i.inventory_item_id) } },
    select: { id: true, name: true, warehouseId: true }
  });
  const itemMetaById = new Map(inventoryItems.map((item) => [item.id, item] as const));

  // Snapshot exportu drží UUID položek bez FK, takže smazaná položka v něm
  // zůstane viset. Vydat ji nejde, vynechá se a vrátí v odpovědi.
  const snapshotNameById = new Map(
    snapshot.groups.flatMap((g) => (g.items ?? []).map((it) => [it.inventoryItemId, it.name] as const))
  );
  const { known: issuableItems, skipped: skippedItems } = splitKnownIssueItems(
    itemsToIssue,
    new Set(itemMetaById.keys()),
    snapshotNameById
  );
  if (issuableItems.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

  const withoutWarehouse = issuableItems
    .filter((i) => !resolveWarehouseId({
      explicitWarehouseId: i.warehouse_id ?? params.warehouseId,
      itemWarehouseId: itemMetaById.get(i.inventory_item_id)?.warehouseId
    }))
    .map((i) => itemMetaById.get(i.inventory_item_id)?.name ?? i.inventory_item_id);
  if (withoutWarehouse.length > 0) {
    const err = new Error("WAREHOUSE_REQUIRED") as Error & { itemNames?: string[] };
    err.itemNames = withoutWarehouse;
    throw err;
  }

  const rows = issuableItems.map((i) => {
    const meta = itemMetaById.get(i.inventory_item_id);
    if (!meta) throw new Error("ITEM_NOT_FOUND");
    const warehouseId = requireWarehouseId({
      explicitWarehouseId: i.warehouse_id ?? params.warehouseId,
      itemWarehouseId: meta.warehouseId
    });
    return {
      eventId,
      inventoryItemId: i.inventory_item_id,
      issuedQuantity: i.issued_quantity,
      warehouseId,
      issuedById: userId,
      dayFrom: day,
      dayTo: i.day_to,
      idempotencyKey:
        i.idempotency_key ??
        `${params.idempotencyKey ?? "issue"}:${eventId}:${i.inventory_item_id}:${day}-${i.day_to ?? "end"}`
    };
  });
  await tx.eventIssue.createMany({ data: rows, skipDuplicates: true });

  // Váha se počítá až z uloženého výdeje, aby šla stejnou cestou jako u doplňkového výdeje.
  const computedWeightKg = await computeIssuedWeightKg(tx, eventId);

  for (const row of rows) {
    await createInventoryLedgerEntry(tx, {
      inventoryItemId: row.inventoryItemId,
      deltaQuantity: -row.issuedQuantity,
      reason: LedgerReason.issue,
      eventId,
      warehouseId: row.warehouseId,
      createdById: userId,
      note: "Výdej na akci"
    });
  }

  // Rozpracované balení vydaného dne je bezpředmětné, stav drží event_issues.
  await tx.eventPacking.deleteMany({ where: { eventId, dayFrom: day } });

  const updated = await tx.event.update({
    where: { id: eventId },
    data: {
      status: "ISSUED",
      ...(params.palletCount !== undefined ? { palletCount: params.palletCount } : {}),
      totalWeight: computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null
    }
  });
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      entityType: "event",
      entityId: eventId,
      action: "issue",
      diffJson: {
        day,
        count: rows.length,
        pallet_count: params.palletCount ?? null,
        total_weight: computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null,
        ...(skippedItems.length > 0 ? { skipped_items: skippedItems } : {})
      }
    }
  });

  return { event: updated, skippedItems, alreadyIssued: false };
}
```

`computeIssuedWeightKg` ověř v `src/services/issueWeight.ts`: pokud přijímá jen `Prisma.TransactionClient`, je volání správně; nic neměň.

- [ ] **Step 3: Nahraď routu `POST /events/:id/issue`**

Celý handler (od `app.post("/events/:id/issue", ...` po jeho uzavírací `});`) nahraď:

```ts
  app.post("/events/:id/issue", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    requireRole(user.role, ["admin", "warehouse"]);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        idempotency_key: z.string().min(8).optional(),
        warehouse_id: z.string().uuid().optional(),
        pallet_count: z.number().int().min(0).optional().nullable(),
        /// Den akce, který se vydává. Jednodenní akce má jen den 1.
        day: z.number().int().min(1).optional(),
        items: z
          .array(
            z.object({
              inventory_item_id: z.string().uuid(),
              issued_quantity: z.number().int().min(0),
              day_to: z.number().int().min(1).nullable().optional(),
              warehouse_id: z.string().uuid().optional(),
              idempotency_key: z.string().min(8).optional()
            })
          )
          .optional()
      })
      .parse(request.body);

    try {
      const result = await app.prisma.$transaction((tx) =>
        issueDayTx({
          tx,
          eventId: params.id,
          userId: user.id,
          day: body.day ?? 1,
          idempotencyKey: body.idempotency_key,
          warehouseId: body.warehouse_id,
          palletCount: body.pallet_count,
          items: body.items
        })
      );

      sseBus.emit({ type: "event_status_changed", eventId: params.id, status: "ISSUED" });
      return reply.send({ event: result.event, skippedItems: result.skippedItems });
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
      if (e?.message === "READ_ONLY") return httpError(reply, 409, "READ_ONLY", "Akci nelze vydat (už je uzavřená/zrušená).");
      if (e?.message === "BAD_STATUS") return httpError(reply, 409, "BAD_STATUS", "Akci lze poprvé vydat pouze ze stavu Předáno skladu.");
      if (e?.message === "NEEDS_REVISION") return httpError(reply, 409, "NEEDS_REVISION", "Akce byla po předání změněna. Je nutný nový export.");
      if (e?.message === "NO_EXPORT") return httpError(reply, 409, "NO_EXPORT", "Akce nemá export. Nejdřív ji předej skladu.");
      if (e?.message === "INVALID_DAY") return httpError(reply, 400, "INVALID_DAY", "Akce takový den nemá.");
      if (e?.message === "NO_ITEMS_TO_ISSUE") return httpError(reply, 409, "NO_ITEMS_TO_ISSUE", "Na tento den nejsou v exportu žádné položky k výdeji.");
      if (e?.message === "DUPLICATE_ITEMS") return httpError(reply, 409, "DUPLICATE_ITEMS", "Každá položka může být ve výdeji jen jednou.");
      if (e?.message === "ITEM_NOT_FOUND") return httpError(reply, 404, "NOT_FOUND", "Některá položka už v inventáři neexistuje.");
      if (e?.message === "WAREHOUSE_REQUIRED") {
        const names: string[] = e?.itemNames ?? [];
        return httpError(
          reply,
          409,
          "WAREHOUSE_REQUIRED",
          names.length > 0
            ? `Tyto položky nemají určený sklad: ${names.join(", ")}. Vyber sklad v poli "Vydáváno ze skladu".`
            : "Každá vydávaná položka musí mít určený sklad."
        );
      }
      request.log.error({ err: e }, "issue failed");
      return httpError(reply, 500, "INTERNAL", "Internal Server Error");
    }
  });
```

(`catch (e: any)` zůstává kvůli shodě se zbytkem souboru, handler jen přesouvá existující mapování chyb.)

Import: `import { getIssuedDaysTx, issueDayTx } from "../services/issueDay.js";` (nahraď import z Task 5).

- [ ] **Step 4: Balení po dnech**

`GET /events/:id/packing`: `select: { inventoryItemId: true, dayFrom: true, dayTo: true, state: true }`.

`PUT /events/:id/packing` nahraď tělo za `requireRole`/`params`:

```ts
    const body = z
      .object({
        inventory_item_id: z.string().uuid(),
        day_from: z.number().int().min(1).optional(),
        day_to: z.number().int().min(1).nullable().optional(),
        state: z.enum(["idle", "armed", "confirmed"])
      })
      .parse(request.body);
    const dayFrom = body.day_from ?? 1;
    const dayTo = body.day_to ?? null;

    const event = await app.prisma.event.findUnique({ where: { id: params.id }, select: { status: true } });
    if (!event) return httpError(reply, 404, "NOT_FOUND", "Akce nenalezena.");
    if (event.status === "ISSUED") {
      // Vícedenní akce se po vydání prvního dne balí dál na další dny.
      const issuedDays = await getIssuedDaysTx(app.prisma, params.id);
      if (issuedDays.includes(dayFrom)) {
        return httpError(reply, 409, "BAD_STATUS", "Tento den už je vydaný.");
      }
    } else if (event.status !== "SENT_TO_WAREHOUSE") {
      return httpError(reply, 409, "BAD_STATUS", "Balit lze jen akci ve stavu Předáno skladu nebo Vydáno.");
    }

    const where = { eventId: params.id, inventoryItemId: body.inventory_item_id, dayFrom, dayTo };
    await app.prisma.$transaction(async (tx) => {
      await tx.eventPacking.deleteMany({ where });
      if (body.state !== "idle") {
        await tx.eventPacking.create({ data: { ...where, state: body.state, updatedById: user.id } });
      }
    });
    return reply.send({ ok: true });
```

- [ ] **Step 5: Úklid importů a typecheck**

Run: `cd apps/api && npx tsc -p tsconfig.typecheck.json`
Expected: bez chyb. Pokud hlásí nepoužité importy v `events.ts` (`splitKnownIssueItems`, `resolveWarehouseId`, `requireWarehouseId`, `computeIssuedWeightKg`, `formatWeightKg`, `LedgerReason`, `createInventoryLedgerEntry`), odeber jen ty, které po přesunu výdeje opravdu nikde v souboru nejsou (`grep -n "<jméno>" apps/api/src/routes/events.ts`).

Run: `grep -rn "eventId_inventoryItemId" apps/api/src apps/api/test`
Expected: žádný výskyt.

- [ ] **Step 6: Spusť testy**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/issueDay.integration.test.ts test/issueAdditional.integration.test.ts test/issuedItems.integration.test.ts test/issueWeight.integration.test.ts test/return-close.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/issueDay.ts apps/api/src/routes/events.ts apps/api/test/issueDay.integration.test.ts
git commit -m "Vydávej a bal vícedenní akci po dnech"
```

---

### Task 7: Kopírování akce se dny

**Files:**
- Modify: `apps/api/src/services/duplicateEvent.ts`
- Test: `apps/api/test/duplicateEventDays.integration.test.ts`

**Interfaces:**
- Consumes: `reserveItemsTx` s `dayFrom`/`dayTo` (Task 3), `getAvailabilityForEventItemsTx(..., { range })` (Task 2), `eventDayCount`, `dayRangeKey`, `DayRange`.
- Produces: `DuplicateAdjustment` má navíc `dayFrom: number; dayTo: number | null`.

- [ ] **Step 1: Napiš padající testy**

`apps/api/test/duplicateEventDays.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { duplicateEventTx } from "../src/services/duplicateEvent.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({ data: { email: `dupd-${stamp}@local`, passwordHash: "x", role: Role.admin } });
  const parent = await prisma.category.create({ data: { name: `Inv-dupd-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Sub-dupd-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({ data: { name: `Stul-${stamp}`, categoryId: child.id, unit: "ks" } });
  await prisma.inventoryLedger.create({
    data: { inventoryItemId: item.id, deltaQuantity: 100, reason: LedgerReason.audit_adjustment, createdById: user.id }
  });
  const source = await prisma.event.create({
    data: {
      name: `Zdroj-${stamp}`,
      location: "L",
      deliveryDatetime: new Date("2031-01-10T07:00:00Z"),
      pickupDatetime: new Date("2031-01-12T17:00:00Z"),
      status: EventStatus.CLOSED,
      createdById: user.id
    }
  });
  const add = (qty: number, dayFrom: number, dayTo: number | null) =>
    prisma.eventReservation.create({
      data: { eventId: source.id, inventoryItemId: item.id, reservedQuantity: qty, state: "confirmed", dayFrom, dayTo }
    });
  const duplicate = (delivery: string, pickup: string) =>
    prisma.$transaction((tx) =>
      duplicateEventTx({
        tx,
        actor: { id: user.id, role: Role.admin },
        sourceEventId: source.id,
        data: {
          name: `Kopie-${stamp}`,
          location: "L",
          address: null,
          notes: null,
          registrationNumber: null,
          eventDate: null,
          deliveryDatetime: new Date(delivery),
          pickupDatetime: new Date(pickup)
        }
      })
    );
  const rowsOf = (eventId: string) =>
    prisma.eventReservation.findMany({
      where: { eventId },
      orderBy: [{ dayFrom: "asc" }, { reservedQuantity: "asc" }],
      select: { dayFrom: true, dayTo: true, reservedQuantity: true }
    });
  return { add, duplicate, rowsOf };
}

describe("kopírování vícedenní akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("kopie stejně dlouhé akce převezme rozsahy dnů", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 2, 2);

    const { event, adjustments } = await f.duplicate("2031-02-10T07:00:00Z", "2031-02-12T17:00:00Z");

    expect(adjustments).toEqual([]);
    expect(await f.rowsOf(event.id)).toEqual([
      { dayFrom: 1, dayTo: null, reservedQuantity: 10 },
      { dayFrom: 2, dayTo: 2, reservedQuantity: 5 }
    ]);
    await disconnect();
  });

  maybe("kopie do kratší akce zkrátí, sečte a vynechá řádky", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(4, 1, 2);
    await f.add(2, 3, 3);

    const { event, adjustments } = await f.duplicate("2031-02-10T07:00:00Z", "2031-02-11T17:00:00Z");

    expect(await f.rowsOf(event.id)).toEqual([{ dayFrom: 1, dayTo: null, reservedQuantity: 14 }]);
    expect(adjustments.map((a) => [a.dayFrom, a.dayTo, a.sourceQty, a.copiedQty])).toEqual([[3, 3, 2, 0]]);
    await disconnect();
  });
});
```

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/duplicateEventDays.integration.test.ts`
Expected: FAIL (dny se nekopírují, řádky se sloučí do jednoho s 16 ks nebo spadne DUPLICATE_ITEMS).

- [ ] **Step 2: Přepiš `src/services/duplicateEvent.ts`**

```ts
import type { Prisma, Role } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemsTx } from "./availability.js";
import { reserveItemsTx } from "./reserve.js";
import { dayRangeKey, eventDayCount, type DayRange } from "../lib/eventDays.js";

/// Řádek, který se do kopie nevešel celý. copiedQty === 0 znamená, že
/// se nepřenesl vůbec.
export type DuplicateAdjustment = {
  inventoryItemId: string;
  name: string;
  unit: string;
  dayFrom: number;
  dayTo: number | null;
  sourceQty: number;
  copiedQty: number;
};

export async function duplicateEventTx(params: {
  tx: Prisma.TransactionClient;
  actor: { id: string; role: Role };
  sourceEventId: string;
  data: {
    name: string;
    location: string;
    address: string | null;
    notes: string | null;
    registrationNumber: string | null;
    eventDate: Date | null;
    deliveryDatetime: Date;
    pickupDatetime: Date;
  };
}) {
  const { tx, actor, sourceEventId, data } = params;

  const source = await tx.event.findUnique({ where: { id: sourceEventId }, select: { id: true } });
  if (!source) throw new Error("EVENT_NOT_FOUND");

  const reservations = await tx.eventReservation.findMany({
    where: { eventId: sourceEventId, reservedQuantity: { gt: 0 } },
    orderBy: [{ inventoryItemId: "asc" }, { dayFrom: "asc" }],
    select: {
      inventoryItemId: true,
      reservedQuantity: true,
      dayFrom: true,
      dayTo: true,
      item: { select: { name: true, unit: true, masterPackageQty: true } }
    }
  });

  const event = await tx.event.create({
    data: { ...data, status: "DRAFT", createdById: actor.id }
  });

  if (reservations.length === 0) return { event, adjustments: [] as DuplicateAdjustment[] };

  const adjustments: DuplicateAdjustment[] = [];

  // Řádky se přizpůsobí délce nové akce. Co začíná až po jejím posledním dni,
  // se nepřenese. Konec za posledním dnem se zkrátí na „do konce akce“ a řádky,
  // které tím dostanou stejný rozsah, se sečtou.
  const dayCount = eventDayCount(data.deliveryDatetime, data.pickupDatetime);
  const merged = new Map<string, { inventoryItemId: string; range: DayRange; qty: number; item: (typeof reservations)[number]["item"] }>();
  for (const r of reservations) {
    if (r.dayFrom > dayCount) {
      adjustments.push({
        inventoryItemId: r.inventoryItemId,
        name: r.item.name,
        unit: r.item.unit,
        dayFrom: r.dayFrom,
        dayTo: r.dayTo,
        sourceQty: r.reservedQuantity,
        copiedQty: 0
      });
      continue;
    }
    const range: DayRange = { dayFrom: r.dayFrom, dayTo: r.dayTo !== null && r.dayTo < dayCount ? r.dayTo : null };
    const key = `${r.inventoryItemId}|${dayRangeKey(range)}`;
    const prev = merged.get(key);
    merged.set(key, { inventoryItemId: r.inventoryItemId, range, qty: (prev?.qty ?? 0) + r.reservedQuantity, item: r.item });
  }

  // Dostupnost se počítá podle termínu nové akce, takže se do kopie nemusí vejít
  // všechno. Množství krátíme dolů na celá master balení - reserveItemsTx by je
  // jinak zaokrouhlil nahoru a spadl na nedostatku zásob. Řádky se rezervují
  // postupně, aby další řádek téže položky viděl ty předchozí.
  for (const m of merged.values()) {
    const [availability] = await getAvailabilityForEventItemsTx(tx, event.id, [m.inventoryItemId], { range: m.range });
    let qty = Math.min(m.qty, Math.max(availability?.available ?? 0, 0));
    const mpq = m.item.masterPackageQty;
    if (mpq && mpq > 0) qty = Math.floor(qty / mpq) * mpq;

    if (qty !== m.qty) {
      adjustments.push({
        inventoryItemId: m.inventoryItemId,
        name: m.item.name,
        unit: m.item.unit,
        dayFrom: m.range.dayFrom,
        dayTo: m.range.dayTo,
        sourceQty: m.qty,
        copiedQty: qty
      });
    }
    if (qty > 0) {
      await reserveItemsTx({
        tx,
        actor,
        eventId: event.id,
        items: [{ inventoryItemId: m.inventoryItemId, qty, dayFrom: m.range.dayFrom, dayTo: m.range.dayTo }]
      });
    }
  }

  return { event, adjustments };
}
```

- [ ] **Step 3: Spusť nové i stávající testy kopírování**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 npx vitest run test/duplicateEventDays.integration.test.ts test/duplicateEvent.integration.test.ts`
Expected: PASS. Pokud stávající test porovnává `adjustments` přes `toEqual` bez `dayFrom`/`dayTo`, doplň do očekávání `dayFrom: 1, dayTo: null`.

- [ ] **Step 4: Celý API test suite**

Run: `cd apps/api && DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 pnpm test`
Expected: typecheck bez chyb, všechny testy PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/duplicateEvent.ts apps/api/test/duplicateEventDays.integration.test.ts apps/api/test/duplicateEvent.integration.test.ts
git commit -m "Kopíruj akci včetně rozsahu dnů u položek"
```

---

### Task 8: Webové pomocné funkce pro dny

**Files:**
- Create: `apps/web/src/lib/eventDays.ts`
- Test: `apps/web/test/eventDays.test.ts`

**Interfaces:**
- Produces: `type DayRange = { dayFrom: number; dayTo: number | null }`, `dayRangeKey(r)`, `sameDayRange(a, b)`, `dayRangeLabel(r, dayCount)`, `reservationRowKey({ inventoryItemId, dayFrom?, dayTo? })`, `eventDayDateLabel(deliveryIso: string, day: number): string`.

- [ ] **Step 1: Napiš padající testy**

`apps/web/test/eventDays.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dayRangeLabel, eventDayDateLabel, reservationRowKey, sameDayRange } from "../src/lib/eventDays";

describe("dny akce na webu", () => {
  it("popisek rozsahu", () => {
    expect(dayRangeLabel({ dayFrom: 1, dayTo: null }, 3)).toBe("Celá akce");
    expect(dayRangeLabel({ dayFrom: 2, dayTo: 2 }, 3)).toBe("Den 2");
    expect(dayRangeLabel({ dayFrom: 2, dayTo: null }, 3)).toBe("Dny 2-3");
    expect(dayRangeLabel({ dayFrom: 1, dayTo: 2 }, 3)).toBe("Dny 1-2");
  });

  it("datum dne se bere v Praze", () => {
    // 5. 10. 2026 22:30 UTC je v Praze už 6. 10.
    expect(eventDayDateLabel("2026-10-05T22:30:00Z", 1)).toBe("6. 10.");
    expect(eventDayDateLabel("2026-10-05T22:30:00Z", 2)).toBe("7. 10.");
    expect(eventDayDateLabel("2026-10-31T08:00:00Z", 2)).toBe("1. 11.");
  });

  it("klíč řádku rozliší rozsahy jedné položky", () => {
    expect(reservationRowKey({ inventoryItemId: "a" })).toBe("a|1-end");
    expect(reservationRowKey({ inventoryItemId: "a", dayFrom: 2, dayTo: 2 })).toBe("a|2-2");
  });

  it("porovnání rozsahů", () => {
    expect(sameDayRange({ dayFrom: 1, dayTo: null }, { dayFrom: 1, dayTo: null })).toBe(true);
    expect(sameDayRange({ dayFrom: 1, dayTo: 1 }, { dayFrom: 1, dayTo: null })).toBe(false);
  });
});
```

Run: `cd apps/web && TZ=Europe/Prague npx vitest run test/eventDays.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 2: Implementuj `apps/web/src/lib/eventDays.ts`**

```ts
// Dny vícedenní akce na webu. Stejná pravidla jako apps/api/src/lib/eventDays.ts:
// den 1 je datum závozu v Praze, dayTo === null znamená „do konce akce“.

export type DayRange = { dayFrom: number; dayTo: number | null };

export function dayRangeKey(range: DayRange): string {
  return `${range.dayFrom}-${range.dayTo ?? "end"}`;
}

export function sameDayRange(a: DayRange, b: DayRange): boolean {
  return a.dayFrom === b.dayFrom && (a.dayTo ?? null) === (b.dayTo ?? null);
}

export function dayRangeLabel(range: DayRange, dayCount: number): string {
  const to = range.dayTo ?? dayCount;
  if (range.dayFrom === 1 && to === dayCount) return "Celá akce";
  if (range.dayFrom === to) return `Den ${range.dayFrom}`;
  return `Dny ${range.dayFrom}-${to}`;
}

/// Klíč řádku položky v akci. Jedna položka může mít víc řádků s různými dny.
export function reservationRowKey(row: { inventoryItemId: string; dayFrom?: number; dayTo?: number | null }): string {
  return `${row.inventoryItemId}|${dayRangeKey({ dayFrom: row.dayFrom ?? 1, dayTo: row.dayTo ?? null })}`;
}

const pragueYmd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/// Kalendářní datum N-tého dne akce, např. „7. 10.“.
export function eventDayDateLabel(deliveryIso: string, day: number): string {
  const [y, m, d] = pragueYmd.format(new Date(deliveryIso)).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + day - 1));
  return `${date.getUTCDate()}. ${date.getUTCMonth() + 1}.`;
}
```

- [ ] **Step 3: Spusť testy**

Run: `cd apps/web && pnpm test`
Expected: PASS (včetně stávajících `datetime.test.ts` a `viewModel.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/eventDays.ts apps/web/test/eventDays.test.ts
git commit -m "Přidej webové pomocníky pro dny akce"
```

---

### Task 9: EM zadává položky po dnech

**Files:**
- Modify: `apps/web/src/pages/EventDetailPage.tsx` (`reservationItems`, načítání dostupnosti, seznam položek, `AddItemsPanel`, náhled exportu)
- Modify: `apps/web/src/components/QuickAddItemsModal.tsx`

**Interfaces:**
- Consumes: `event.dayCount` a `event.deliveryDatetime` z `GET /events/:id` (Task 5), `POST /events/:id/reserve` a `/availability` s `day_from`/`day_to` (Task 2, 3), web helpery z Task 8.
- Produces: `AddItemsPanel` má nové props `dayCount: number` a `deliveryDatetime: string`. `QuickAddItemsModal` má nový prop `range: DayRange`.

- [ ] **Step 1: Řádky rezervací nesou dny**

V `EventDetailPage.tsx` přidej import:

```ts
import { dayRangeKey, dayRangeLabel, eventDayDateLabel, reservationRowKey, sameDayRange, type DayRange } from "../lib/eventDays";
```

V memu `reservationItems` rozšiř typ na `Array<{ inventoryItemId: string; reservedQuantity: number; state: string; item: any; dayFrom: number; dayTo: number | null }>` a do mapování přidej:

```ts
      dayFrom: Number(r.dayFrom ?? 1),
      dayTo: r.dayTo ?? null,
```

(`item: any` je stávající typ, neměň ho.)

- [ ] **Step 2: Dostupnost po rozsazích**

Stávající `useEffect` načítající `/events/${id}/availability` pro `reservationItems` nahraď:

```ts
  const reservationRowsKey = reservationItems.map((r) => reservationRowKey(r)).join(",");

  useEffect(() => {
    if (!id) return;
    if (reservationItems.length === 0) {
      setStockByItemId(new Map());
      return;
    }
    // Každý rozsah dnů má jiný interval, dostupnost se proto načítá po rozsazích.
    const groups = new Map<string, { range: DayRange; ids: string[] }>();
    for (const r of reservationItems) {
      const range = { dayFrom: r.dayFrom, dayTo: r.dayTo };
      const group = groups.get(dayRangeKey(range)) ?? { range, ids: [] };
      group.ids.push(r.inventoryItemId);
      groups.set(dayRangeKey(range), group);
    }
    Promise.all(
      Array.from(groups.values()).map((g) =>
        api<{ rows: StockRow[] }>(`/events/${id}/availability`, {
          method: "POST",
          body: JSON.stringify({ inventory_item_ids: g.ids, day_from: g.range.dayFrom, day_to: g.range.dayTo })
        }).then((r) =>
          r.rows.map((x) => [reservationRowKey({ inventoryItemId: x.inventoryItemId, ...g.range }), x] as const)
        )
      )
    )
      .then((lists) => setStockByItemId(new Map(lists.flat())))
      .catch(() => { });
  }, [id, reservationRowsKey]);
```

Mapa `stockByItemId` je teď klíčovaná `reservationRowKey`. V seznamu položek změň `stockByItemId.get(r.inventoryItemId)` na `stockByItemId.get(reservationRowKey(r))`. Ověř `grep -n "stockByItemId" apps/web/src/pages/EventDetailPage.tsx`, že jiné čtení mapy není.

- [ ] **Step 3: Seznam položek ukazuje rozsah**

V renderu řádku (`g.rows.map((r: any) => { ... })`):
- `key={r.inventoryItemId}` změň na `key={reservationRowKey(r)}`.
- Pod `<div className="truncate text-sm font-semibold">{r.item?.name}</div>` přidej:

```tsx
                                    {event.dayCount > 1 ? (
                                      <div className="mt-1">
                                        <Badge tone="neutral">{dayRangeLabel({ dayFrom: r.dayFrom, dayTo: r.dayTo }, event.dayCount)}</Badge>
                                      </div>
                                    ) : null}
```

- V tlačítku odebrání změň tělo požadavku na:

```ts
                                              body: JSON.stringify({
                                                items: [{ inventory_item_id: r.inventoryItemId, qty: 0, day_from: r.dayFrom, day_to: r.dayTo }]
                                              })
```

V memu `grouped` seřaď řádky skupiny: za cyklus `for (const r of reservationItems)` přidej `for (const g of groups.values()) g.rows.sort((a, b) => String(a.item?.name ?? "").localeCompare(String(b.item?.name ?? ""), "cs") || a.dayFrom - b.dayFrom);`.

- [ ] **Step 4: `AddItemsPanel` s volbou dnů**

Na místě použití `<AddItemsPanel ... />` přidej props:

```tsx
        dayCount={event.dayCount ?? 1}
        deliveryDatetime={event.deliveryDatetime}
```

V definici `function AddItemsPanel(props: { ... })` přidej do typu props `dayCount: number; deliveryDatetime: string;` a typ `existingItems` rozšiř o `dayFrom: number; dayTo: number | null`. Stejně rozšiř typ stavu `currentItems`.

Pod `const userId = getCurrentUser()?.id;` přidej:

```ts
  // U vícedenní akce EM volí, pro které dny zadává počty. Panel pak ukazuje
  // jen řádky tohoto rozsahu a dostupnost pro něj.
  const [range, setRange] = useState<DayRange>({ dayFrom: 1, dayTo: null });
  const rangeKey = dayRangeKey(range);
  const dayNumbers = useMemo(() => Array.from({ length: props.dayCount }, (_, i) => i + 1), [props.dayCount]);
  const dayOptionLabel = (d: number) => `Den ${d} (${eventDayDateLabel(props.deliveryDatetime, d)})`;

  useEffect(() => {
    if (!props.open) setRange({ dayFrom: 1, dayTo: null });
  }, [props.open]);

  useEffect(() => {
    setQty({});
  }, [rangeKey]);
```

Efekt, který plní `currentItems` a `qty` z `props.existingItems`, změň na filtr podle rozsahu a přidej `rangeKey` do závislostí:

```ts
  useEffect(() => {
    if (!props.open) return;
    const nextItems = props.existingItems.filter(
      (r) => Number(r.reservedQuantity) > 0 && sameDayRange({ dayFrom: r.dayFrom, dayTo: r.dayTo }, range)
    );
    setCurrentItems(nextItems);
    setQty((prev) => {
      const next = { ...prev };
      for (const item of nextItems) {
        next[item.inventoryItemId] = Number(item.reservedQuantity);
      }
      return next;
    });
  }, [props.open, props.existingItems, rangeKey]);
```

Ve funkci `load` rozšiř tělo požadavku na dostupnost:

```ts
          body: JSON.stringify({ inventory_item_ids: ids, day_from: range.dayFrom, day_to: range.dayTo })
```

a do závislostí efektu, který volá `load` přes `setTimeout`, přidej `rangeKey`.

V `applyReservation` rozšiř tělo:

```ts
        body: JSON.stringify({
          items: [{ inventory_item_id: params.inventoryItemId, qty: normalizedQty, day_from: range.dayFrom, day_to: range.dayTo }]
        })
```

a do `nextItem` přidej `dayFrom: range.dayFrom, dayTo: range.dayTo,`.

V JSX hned za `<div className="flex flex-col gap-4 md:h-full md:min-h-0">` (první sloupec panelu, před blok `{!isChef ? (`) vlož:

```tsx
          {props.dayCount > 1 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
              <span className="font-semibold text-amber-950">Zadávám pro dny:</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
                value={range.dayFrom}
                onChange={(e) => {
                  const from = Number(e.target.value);
                  setRange((r) => ({ dayFrom: from, dayTo: r.dayTo !== null && r.dayTo < from ? from : r.dayTo }));
                }}
              >
                {dayNumbers.map((d) => (
                  <option key={d} value={d}>{dayOptionLabel(d)}</option>
                ))}
              </select>
              <span className="text-amber-900">až</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
                value={range.dayTo ?? props.dayCount}
                onChange={(e) => {
                  const to = Number(e.target.value);
                  setRange((r) => ({ dayFrom: r.dayFrom, dayTo: to >= props.dayCount ? null : to }));
                }}
              >
                {dayNumbers.filter((d) => d >= range.dayFrom).map((d) => (
                  <option key={d} value={d}>{dayOptionLabel(d)}</option>
                ))}
              </select>
              <span className="text-xs text-amber-800">
                Stejná položka může mít na jiné dny jiný počet. Volné množství platí pro zvolené dny.
              </span>
            </div>
          ) : null}
```

Popis modalu (`description="Zobrazujeme dostupnost pro termín této akce."`) změň na:

```tsx
      description={props.dayCount > 1 ? `Zobrazujeme dostupnost pro ${dayRangeLabel(range, props.dayCount).toLowerCase()}.` : "Zobrazujeme dostupnost pro termín této akce."}
```

- [ ] **Step 5: Zjednodušené přidání respektuje rozsah**

Na místě použití `<QuickAddItemsModal ... />` v `AddItemsPanel` přidej `range={range}`.

V `QuickAddItemsModal.tsx` přidej import `import type { DayRange } from "../lib/eventDays";`, do props `range: DayRange;` a:
- do těla požadavku na dostupnost `day_from: props.range.dayFrom, day_to: props.range.dayTo,`,
- do závislostí toho efektu `props.range.dayFrom, props.range.dayTo`,
- v `submit` do každé položky `day_from: props.range.dayFrom, day_to: props.range.dayTo`.

- [ ] **Step 6: Náhled exportu ukazuje dny**

V náhledu exportu (render `exportPreview.groups ... items.map((item: any, j: number) => <li key={j}>...`) přidej za název štítek, jen pokud `exportPreview.event?.dayCount > 1`:

```tsx
                      <li key={j}>
                        {item.name}
                        {exportPreview.event?.dayCount > 1 ? ` (${dayRangeLabel({ dayFrom: item.dayFrom ?? 1, dayTo: item.dayTo ?? null }, exportPreview.event.dayCount)})` : ""}
                        {" "}— <strong>{item.qty} {item.unit}</strong>
                      </li>
```

(Pomlčka `—` je ve stávajícím textu, nová se nepřidává.)

- [ ] **Step 7: Build a ruční ověření**

Run: `cd apps/web && pnpm build`
Expected: `tsc` i `vite build` bez chyb.

Ruční ověření (lokální DB, ne produkce): spusť API s `DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" pnpm --filter @cater-sklad/api dev` a web `pnpm --filter @cater-sklad/web dev`. Založ třídenní akci, v panelu přidej „Židle 50 ks, Den 1 až Den 3“ a „Židle 70 ks, Den 2 až Den 2“. V seznamu musí být dva řádky se štítky „Celá akce“ a „Den 2“, u každého vlastní „Volné“. Odebrání řádku „Den 2“ nesmí smazat řádek „Celá akce“. U jednodenní akce se volba dnů nesmí zobrazit.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/EventDetailPage.tsx apps/web/src/components/QuickAddItemsModal.tsx
git commit -m "Umožni EM zadávat položky vícedenní akce po dnech"
```

---

### Task 10: Sklad balí a vydává po dnech

**Files:**
- Create: `apps/web/src/components/DayPackingCard.tsx`
- Modify: `apps/web/src/pages/WarehouseEventDetailPage.tsx`

**Interfaces:**
- Consumes: `event.dayCount`, `event.issuedDays`, snapshot položky s `dayFrom`/`dayTo` (Task 5), `POST /issue` s `day`, `GET/PUT /packing` s dny (Task 6), `GET /exports/:version/pdf?day=N` (Task 5), web helpery (Task 8).
- Produces: komponenta `DayPackingCard` s props `{ eventId: string; dayCount: number; deliveryDatetime: string; exportVersion: number | null; items: DayPackingItem[]; issuedDays: number[]; warehouses: Array<{ id: string; name: string }>; onIssued: () => Promise<void> | void }`.

- [ ] **Step 1: Vytvoř `DayPackingCard.tsx`**

Nejdřív ověř props `Button`: `grep -n "variant\|size" apps/web/src/components/ui/Button.tsx`. Níže se používá `variant="secondary"`, `size="sm"` a výchozí varianta; pokud se jmenují jinak, použij stávající názvy.

```tsx
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api, apiBaseUrl } from "../lib/api";
import { cn } from "../lib/ui";
import { dayRangeLabel, eventDayDateLabel, reservationRowKey } from "../lib/eventDays";
import { Card, CardContent, CardHeader } from "./ui/Card";
import Button from "./ui/Button";
import ConfirmDialog from "./ui/ConfirmDialog";

export type DayPackingItem = {
  inventoryItemId: string;
  name: string;
  unit: string;
  qty: number;
  dayFrom?: number;
  dayTo?: number | null;
};

type PackingState = "idle" | "armed" | "confirmed";
type PackingRow = { inventoryItemId: string; dayFrom: number; dayTo: number | null; state: PackingState };

function errorMessage(e: unknown, fallback: string): string {
  const message = (e as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : fallback;
}

/**
 * Balení a výdej vícedenní akce po dnech. Den N obsahuje řádky, které ten den
 * odjíždějí ze skladu. Jednodenní akce tuhle kartu nepoužívá.
 */
export default function DayPackingCard(props: {
  eventId: string;
  dayCount: number;
  deliveryDatetime: string;
  exportVersion: number | null;
  items: DayPackingItem[];
  issuedDays: number[];
  warehouses: Array<{ id: string; name: string }>;
  onIssued: () => Promise<void> | void;
}) {
  const daysWithItems = useMemo(
    () => Array.from(new Set(props.items.map((i) => i.dayFrom ?? 1))).sort((a, b) => a - b),
    [props.items]
  );
  const firstPendingDay = daysWithItems.find((d) => !props.issuedDays.includes(d)) ?? daysWithItems[0] ?? 1;
  const [day, setDay] = useState(firstPendingDay);
  const [states, setStates] = useState<Record<string, PackingState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    setDay(firstPendingDay);
  }, [firstPendingDay]);

  useEffect(() => {
    api<{ packing: PackingRow[] }>(`/events/${props.eventId}/packing`)
      .then((res) => setStates(Object.fromEntries(res.packing.map((p) => [reservationRowKey(p), p.state]))))
      .catch(() => {});
  }, [props.eventId, props.issuedDays.length]);

  const dayItems = useMemo(
    () => props.items.filter((i) => (i.dayFrom ?? 1) === day).sort((a, b) => a.name.localeCompare(b.name, "cs")),
    [props.items, day]
  );
  const dayIssued = props.issuedDays.includes(day);
  const confirmedCount = dayItems.filter((i) => states[reservationRowKey(i)] === "confirmed").length;

  const toggle = async (item: DayPackingItem) => {
    const key = reservationRowKey(item);
    const previous = states[key] ?? "idle";
    const next: PackingState = previous === "confirmed" ? "idle" : "confirmed";
    setStates((s) => ({ ...s, [key]: next }));
    try {
      await api(`/events/${props.eventId}/packing`, {
        method: "PUT",
        body: JSON.stringify({
          inventory_item_id: item.inventoryItemId,
          day_from: item.dayFrom ?? 1,
          day_to: item.dayTo ?? null,
          state: next
        })
      });
    } catch (e: unknown) {
      setStates((s) => ({ ...s, [key]: previous }));
      toast.error(errorMessage(e, "Nepodařilo se uložit stav balení."));
    }
  };

  const issueDay = async () => {
    try {
      const res = await api<{ skippedItems?: Array<{ name: string }> }>(`/events/${props.eventId}/issue`, {
        method: "POST",
        body: JSON.stringify({
          day,
          idempotency_key: `day${day}:${Date.now()}`,
          warehouse_id: warehouseId || undefined
        })
      });
      toast.success(`Den ${day} vydán`);
      if (res?.skippedItems?.length) {
        toast.error(`Nevydáno (položka už není v inventáři): ${res.skippedItems.map((i) => i.name).join(", ")}`, {
          duration: 12000
        });
      }
      await props.onIssued();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Nepodařilo se vydat den."));
    }
  };

  const openDayPdf = () => {
    const token = localStorage.getItem("token");
    window.open(
      `${apiBaseUrl()}/events/${props.eventId}/exports/${props.exportVersion}/pdf?day=${day}&token=${encodeURIComponent(token ?? "")}`,
      "_blank"
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-semibold">Balení po dnech</div>
        <div className="mt-1 text-sm text-slate-600">
          Vícedenní akce se balí a vydává po dnech. Každý den obsahuje položky, které ten den odjíždějí ze skladu.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {daysWithItems.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                d === day ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              Den {d} ({eventDayDateLabel(props.deliveryDatetime, d)}){props.issuedDays.includes(d) ? " · vydáno" : ""}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {dayItems.length === 0 ? (
          <div className="text-sm text-slate-600">Na tento den nic neodjíždí.</div>
        ) : (
          <div className="space-y-2">
            {dayItems.map((item) => {
              const confirmed = states[reservationRowKey(item)] === "confirmed";
              return (
                <div
                  key={reservationRowKey(item)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-2xl border p-3",
                    confirmed ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{item.name}</div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      {item.qty} {item.unit} · {dayRangeLabel({ dayFrom: item.dayFrom ?? 1, dayTo: item.dayTo ?? null }, props.dayCount)}
                    </div>
                  </div>
                  {!dayIssued ? (
                    <Button size="sm" variant={confirmed ? "secondary" : undefined} onClick={() => toggle(item)}>
                      {confirmed ? "Vrátit" : "Zabaleno"}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {dayIssued ? (
          <div className="mt-3 text-sm font-medium text-emerald-700">Den {day} je vydaný.</div>
        ) : dayItems.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {props.exportVersion ? (
              <Button variant="secondary" onClick={openDayPdf}>
                PDF na den {day}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              Vydat podle PDF
            </Button>
            <Button disabled={confirmedCount < dayItems.length} onClick={() => setConfirmOpen(true)}>
              Vydat den {day} ({confirmedCount}/{dayItems.length})
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Vydat den ${day}?`}
        description="Položky tohoto dne se odečtou ze skladu. Ostatní dny zůstanou k vydání."
        confirmText={`Vydat den ${day}`}
        onConfirm={issueDay}
      >
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">Vydáváno ze skladu</span>
          <select
            className="block w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">(Výchozí sklad položky)</option>
            {props.warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      </ConfirmDialog>
    </Card>
  );
}
```

- [ ] **Step 2: Zapoj kartu do `WarehouseEventDetailPage.tsx`**

1. Import: `import DayPackingCard from "../components/DayPackingCard";` a `import { dayRangeLabel } from "../lib/eventDays";`.
2. Typ `Snapshot` rozšiř u položek o `dayFrom?: number; dayTo?: number | null` a typ `PackingChange` o `dayFrom?: number; dayTo?: number | null`.
3. Za memo `warehouseItems` přidej:

```ts
  // Vícedenní akce se balí a vydává v kartě „Balení po dnech“. Stávající
  // manuální a digitální výdej zůstává jen pro jednodenní akce.
  const dayCount: number = event?.dayCount ?? 1;
  const isMultiDay = dayCount > 1;
  const issuedDays: number[] = event?.issuedDays ?? [];
  const hasPendingDays = useMemo(
    () => snapshotItems.some((i) => !issuedDays.includes(i.dayFrom ?? 1)),
    [snapshotItems, issuedDays]
  );

  useEffect(() => {
    if (isMultiDay && issueMode !== null) setIssueMode(null);
  }, [isMultiDay, issueMode]);
```

(`loadPacking` nastavuje `issueMode` na „digital“, pokud existují rozbalené řádky. U vícedenní akce ho tento efekt vrátí na `null`.)

4. V kartě „Akce“ uvnitř větve `{event.status === "SENT_TO_WAREHOUSE" ? (` vlož před stávající `<div className="space-y-4">` podmínku, takže větev bude:

```tsx
            {event.status === "SENT_TO_WAREHOUSE" ? (
              isMultiDay ? (
                <div className="text-sm text-slate-600">
                  Vícedenní akce se vydává po dnech v kartě „Balení po dnech“ níže.
                </div>
              ) : (
                <div className="space-y-4">
                  ...stávající obsah beze změny...
                </div>
              )
            ) : (
```

5. Těsně před kartu „Položky“ (`<Card>` s nadpisem `Položky`) vlož:

```tsx
      {isMultiDay && (event.status === "SENT_TO_WAREHOUSE" || (event.status === "ISSUED" && hasPendingDays)) ? (
        <DayPackingCard
          eventId={event.id}
          dayCount={dayCount}
          deliveryDatetime={event.deliveryDatetime}
          exportVersion={snapshot?.event?.version ?? null}
          items={snapshotItems}
          issuedDays={issuedDays}
          warehouses={warehouses}
          onIssued={load}
        />
      ) : null}
```

6. V seznamu změn balení po předání (render `packingChanges.map((c, i) => ...)`) doplň za název položky štítek u vícedenní akce:

```tsx
{isMultiDay ? ` (${dayRangeLabel({ dayFrom: c.dayFrom ?? 1, dayTo: c.dayTo ?? null }, dayCount)})` : ""}
```

- [ ] **Step 3: Build**

Run: `cd apps/web && pnpm build`
Expected: bez chyb.

- [ ] **Step 4: Ruční ověření v prohlížeči**

S lokální DB (viz Task 9 Step 7) a třídenní akcí s řádky „Židle 50 celá akce“ a „Židle 70 den 2“:
1. EM předá akci skladu. Ve skladu se zobrazí karta „Balení po dnech“ s „Den 1“ a „Den 2“, volba manuální/digitální výdej je schovaná, seznam „Položky“ ukazuje Židle 120 ks.
2. „PDF na den 2“ otevře PDF jen s 70 židlemi a titulkem „Den 2“.
3. Odškrtni Den 1, „Vydat den 1“. Akce je Vydáno, karta dál ukazuje Den 2 k vydání, Den 1 „vydáno“.
4. Obnov stránku uprostřed balení dne 2: stav odškrtnutí zůstane.
5. Vydej Den 2. Karta zmizí, zbývá „Vydat navíc“ a „Uzavřít akci“, vrácení nabízí 120 ks.
6. Jednodenní akce: obrazovka skladu vypadá a funguje jako dřív (manuální i digitální výdej).

Nahraj průběh jako GIF (`day_packing_flow.gif`), pokud je k dispozici nástroj pro záznam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/DayPackingCard.tsx apps/web/src/pages/WarehouseEventDetailPage.tsx
git commit -m "Přidej skladu balení a výdej vícedenní akce po dnech"
```

---

### Task 11: Dokumentace a závěrečné ověření

**Files:**
- Modify: `agent.md` (nová sekce o vícedenních akcích)

- [ ] **Step 1: Doplň `agent.md`**

Přidej sekci (umísti ji k ostatním popisům chování skladu, styl a jazyk podle okolí):

```markdown
### Vícedenní akce po dnech (od 2026-09-30)

- Řádek položky v akci má rozsah `day_from` / `day_to` (`day_to = NULL` = do konce akce). Jedna položka může mít víc řádků s různými dny. Rozsah končící posledním dnem se ukládá jako `NULL`.
- Dny se neukládají na akci, odvozují se ze závozu a svozu: den 1 = datum závozu, hranice dnů je půlnoc `Europe/Prague`. Počítají je SQL funkce `event_day_count`, `event_day_start`, `event_day_end` z migrace `20260930090000_multi_day_rows`.
- Unikátní klíč řádků rezervací a balení je výrazový index s `COALESCE(day_to, 0)`. Prisma ho ve schématu neumí, `prisma db push` ho nevytvoří: lokálně po `db push` pusť `prisma db execute --file` s touto migrací.
- Dostupnost počítá jediná funkce `getItemsAvailabilityTx` v `services/availability.ts` (detail akce i skladové přehledy). Blokuje špička souběžného vytížení a rezervace blokuje až do konce řádku plus `return_delay_days`.
- Výdej jde po dnech (`POST /events/:id/issue` s `day`), vydané dny = rozlišné `day_from` v `event_issues`. Doplňkový výdej má `day_from = NULL` a vydaný den nevytváří.
- Vydaný řádek rezervace (existuje řádek výdeje se stejným klíčem akce, položka, `day_from`, `day_to`) už neblokuje: výdej ho odečetl z fyzického stavu a zpět se počítá virtuálním návratem. Dřív se vydané zboží překrývající se akce odečítalo dvakrát.
```

- [ ] **Step 2: Kompletní ověření**

```bash
cd /Users/lukasseifert/Development/Cater_sklad
DATABASE_URL="postgresql://cater:cater@localhost:5432/cater_sklad" RUN_DB_TESTS=1 pnpm --filter @cater-sklad/api test
pnpm --filter @cater-sklad/web test
pnpm --filter @cater-sklad/web build
pnpm --filter @cater-sklad/api build
grep -rn "—" apps/web/src/components/DayPackingCard.tsx apps/web/src/lib/eventDays.ts apps/api/src/lib/eventDays.ts apps/api/src/services/issueDay.ts apps/api/src/services/eventDayChange.ts
```

Expected: všechny testy PASS, oba buildy bez chyb, `grep` na dlouhou pomlčku v nových souborech nic nenajde.

- [ ] **Step 3: Migrace nanečisto proti kopii produkčního schématu**

Neprováděj nic proti produkci. Požádej uživatele o potvrzení, že produkční Supabase je PostgreSQL 15 nebo novější (migrace používá jen standardní SQL, ale uživatel má verzi ověřit sám, např. v Supabase dashboardu). Upozorni ho, že merge PR spustí `prisma migrate deploy` na produkci.

- [ ] **Step 4: Commit a PR (jen se souhlasem uživatele)**

```bash
git add agent.md
git commit -m "Popiš vícedenní akce po dnech v agent.md"
```

PR se otevírá až na výslovný pokyn uživatele (`gh pr create` do `main`, popis zakončený řádkem `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).
