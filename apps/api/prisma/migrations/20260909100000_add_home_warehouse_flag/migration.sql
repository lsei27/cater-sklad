-- Domaci sklad jako priznak na skladu, ne natvrdo v kodu. Do ted se poznaval
-- podle jmena ("liboc"), coz matchovalo i "Liboc levy kontejner" a slo zmenit
-- jen deployem.
ALTER TABLE "warehouses" ADD COLUMN "is_home" BOOLEAN NOT NULL DEFAULT false;

-- Nejvyse jeden domaci sklad.
CREATE UNIQUE INDEX "warehouses_single_home" ON "warehouses" ("is_home") WHERE "is_home";

-- Backfill: na ciste databazi je to no-op.
UPDATE "warehouses" SET "is_home" = true WHERE "name" = 'Liboc';
