-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "event_issues" ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "event_returns" ADD COLUMN     "target_warehouse_id" UUID;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "dismissed_cross_sell_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pallet_count" INTEGER,
ADD COLUMN     "total_weight" TEXT;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "master_package_qty" INTEGER,
ADD COLUMN     "master_package_weight" TEXT,
ADD COLUMN     "plate_diameter" TEXT,
ADD COLUMN     "qr_code" TEXT,
ADD COLUMN     "volume" TEXT,
ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "inventory_ledger" ADD COLUMN     "warehouse_id" UUID;

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_sell_links" (
    "id" UUID NOT NULL,
    "source_item_id" UUID NOT NULL,
    "target_item_id" UUID NOT NULL,

    CONSTRAINT "cross_sell_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_blocks" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "blocked_quantity" INTEGER NOT NULL,
    "blocked_until" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfers" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "transferred_by" UUID NOT NULL,
    "transferred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_name_key" ON "warehouses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cross_sell_links_source_item_id_target_item_id_key" ON "cross_sell_links"("source_item_id", "target_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_blocks_event_id_inventory_item_id_key" ON "warehouse_blocks"("event_id", "inventory_item_id");

-- CreateIndex
CREATE INDEX "inventory_items_warehouse_id_idx" ON "inventory_items"("warehouse_id");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_issues" ADD CONSTRAINT "event_issues_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_returns" ADD CONSTRAINT "event_returns_target_warehouse_id_fkey" FOREIGN KEY ("target_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_links" ADD CONSTRAINT "cross_sell_links_source_item_id_fkey" FOREIGN KEY ("source_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_links" ADD CONSTRAINT "cross_sell_links_target_item_id_fkey" FOREIGN KEY ("target_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_blocks" ADD CONSTRAINT "warehouse_blocks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_blocks" ADD CONSTRAINT "warehouse_blocks_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

