-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "event_exports" DROP CONSTRAINT "event_exports_event_id_fkey";

-- DropForeignKey
ALTER TABLE "event_exports" DROP CONSTRAINT "event_exports_exported_by_fkey";

-- DropForeignKey
ALTER TABLE "event_issues" DROP CONSTRAINT "event_issues_event_id_fkey";

-- DropForeignKey
ALTER TABLE "event_issues" DROP CONSTRAINT "event_issues_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "event_issues" DROP CONSTRAINT "event_issues_issued_by_fkey";

-- DropForeignKey
ALTER TABLE "event_reservations" DROP CONSTRAINT "event_reservations_event_id_fkey";

-- DropForeignKey
ALTER TABLE "event_reservations" DROP CONSTRAINT "event_reservations_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "event_returns" DROP CONSTRAINT "event_returns_event_id_fkey";

-- DropForeignKey
ALTER TABLE "event_returns" DROP CONSTRAINT "event_returns_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "event_returns" DROP CONSTRAINT "event_returns_returned_by_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_created_by_fkey";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_category_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_ledger" DROP CONSTRAINT "inventory_ledger_created_by_fkey";

-- DropForeignKey
ALTER TABLE "inventory_ledger" DROP CONSTRAINT "inventory_ledger_event_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_ledger" DROP CONSTRAINT "inventory_ledger_inventory_item_id_fkey";

-- DropIndex
DROP INDEX "idx_exports_event_version";

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "event_exports" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "event_issues" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "event_reservations" ADD COLUMN     "created_by" UUID,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "event_returns" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inventory_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inventory_ledger" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "role_category_access" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "role_category_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_category_access_role_category_id_key" ON "role_category_access"("role", "category_id");

-- CreateIndex
CREATE INDEX "inventory_items_category_id_idx" ON "inventory_items"("category_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reservations" ADD CONSTRAINT "event_reservations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reservations" ADD CONSTRAINT "event_reservations_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reservations" ADD CONSTRAINT "event_reservations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_category_access" ADD CONSTRAINT "role_category_access_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_exports" ADD CONSTRAINT "event_exports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_exports" ADD CONSTRAINT "event_exports_exported_by_fkey" FOREIGN KEY ("exported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_issues" ADD CONSTRAINT "event_issues_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_issues" ADD CONSTRAINT "event_issues_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_issues" ADD CONSTRAINT "event_issues_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_returns" ADD CONSTRAINT "event_returns_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_returns" ADD CONSTRAINT "event_returns_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_returns" ADD CONSTRAINT "event_returns_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_audit_entity" RENAME TO "audit_log_entity_type_entity_id_idx";
