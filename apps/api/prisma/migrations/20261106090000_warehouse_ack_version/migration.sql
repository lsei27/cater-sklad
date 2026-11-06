-- Verze exportu, kterou sklad potvrdil. Změny v novějších verzích se skladu zvýrazní.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "warehouse_ack_version" INTEGER;

-- Rozběhnuté akce se berou jako už viděné, jinak by se po nasazení u každé
-- akce s víc verzemi rozsvítily všechny staré změny od v1.
UPDATE "events" e
SET "warehouse_ack_version" = x.max_version
FROM (SELECT event_id, MAX(version) AS max_version FROM event_exports GROUP BY event_id) x
WHERE x.event_id = e.id AND e."warehouse_ack_version" IS NULL;
