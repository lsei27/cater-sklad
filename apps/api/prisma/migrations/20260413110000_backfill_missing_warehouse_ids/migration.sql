UPDATE "event_issues" ei
SET "warehouse_id" = ii."warehouse_id"
FROM "inventory_items" ii
WHERE ei."inventory_item_id" = ii."id"
  AND ei."warehouse_id" IS NULL
  AND ii."warehouse_id" IS NOT NULL;

UPDATE "event_returns" er
SET "target_warehouse_id" = ii."warehouse_id"
FROM "inventory_items" ii
WHERE er."inventory_item_id" = ii."id"
  AND er."target_warehouse_id" IS NULL
  AND ii."warehouse_id" IS NOT NULL;

UPDATE "inventory_ledger" l
SET "warehouse_id" = matched."warehouse_id"
FROM (
  SELECT DISTINCT ON (l."id")
    l."id",
    ei."warehouse_id"
  FROM "inventory_ledger" l
  JOIN "event_issues" ei
    ON ei."event_id" = l."event_id"
   AND ei."inventory_item_id" = l."inventory_item_id"
   AND ei."warehouse_id" IS NOT NULL
   AND (
     (l."reason"::text = 'issue' AND ei."type" = 'issued' AND ei."issued_quantity" = ABS(l."delta_quantity"))
     OR (l."reason"::text = 'breakage' AND ei."type" = 'broken' AND ei."issued_quantity" = ABS(l."delta_quantity"))
     OR (l."reason"::text = 'missing' AND ei."type" = 'missing' AND ei."issued_quantity" = ABS(l."delta_quantity"))
   )
  WHERE l."warehouse_id" IS NULL
) AS matched
WHERE l."id" = matched."id";

UPDATE "inventory_ledger" l
SET "warehouse_id" = matched."target_warehouse_id"
FROM (
  SELECT DISTINCT ON (l."id")
    l."id",
    er."target_warehouse_id"
  FROM "inventory_ledger" l
  JOIN "event_returns" er
    ON er."event_id" = l."event_id"
   AND er."inventory_item_id" = l."inventory_item_id"
   AND er."target_warehouse_id" IS NOT NULL
   AND l."reason"::text = 'return'
   AND er."returned_quantity" = l."delta_quantity"
  WHERE l."warehouse_id" IS NULL
) AS matched
WHERE l."id" = matched."id";

UPDATE "inventory_ledger" l
SET "warehouse_id" = ii."warehouse_id"
FROM "inventory_items" ii
WHERE l."inventory_item_id" = ii."id"
  AND l."warehouse_id" IS NULL
  AND ii."warehouse_id" IS NOT NULL;
