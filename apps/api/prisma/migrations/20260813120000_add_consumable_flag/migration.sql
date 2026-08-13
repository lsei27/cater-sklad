-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN "consumable" BOOLEAN NOT NULL DEFAULT false;

-- Zboží (alkohol, mléko, káva) se z akce nevrací celé, skutečný stav se zjistí
-- až při fyzickém vracení. Předvyplníme příznak podle hlavní kategorie "Zboží",
-- dál se edituje po položkách.
UPDATE "inventory_items" ii
SET "consumable" = true
FROM "categories" c
LEFT JOIN "categories" p ON p."id" = c."parent_id"
WHERE ii."category_id" = c."id"
  AND (c."name" = 'Zboží' OR p."name" = 'Zboží');
