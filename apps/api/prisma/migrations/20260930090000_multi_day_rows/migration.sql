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
