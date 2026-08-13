-- CreateTable
CREATE TABLE "event_packing" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_packing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_packing_event_id_inventory_item_id_key" ON "event_packing"("event_id", "inventory_item_id");

-- CreateIndex
CREATE INDEX "idx_packing_event" ON "event_packing"("event_id");

-- AddForeignKey
ALTER TABLE "event_packing" ADD CONSTRAINT "event_packing_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_packing" ADD CONSTRAINT "event_packing_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_packing" ADD CONSTRAINT "event_packing_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stejná konvence jako u ostatních tabulek: RLS zapnutá kvůli Supabase linteru,
-- bez politik (aplikace jde přímým spojením přes Prismu).
ALTER TABLE "event_packing" ENABLE ROW LEVEL SECURITY;
