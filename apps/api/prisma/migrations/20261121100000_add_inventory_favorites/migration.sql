BEGIN;

CREATE TABLE "inventory_favorites" (
    "user_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,

    CONSTRAINT "inventory_favorites_pkey" PRIMARY KEY ("user_id", "inventory_item_id"),
    CONSTRAINT "inventory_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_favorites_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "inventory_favorites_inventory_item_id_idx" ON "inventory_favorites"("inventory_item_id");

ALTER TABLE "inventory_favorites" ENABLE ROW LEVEL SECURITY;

COMMIT;
