-- Init schema for Cater sklad
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('admin','event_manager','chef','warehouse');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LedgerReason" AS ENUM ('purchase','writeoff','audit_adjustment','breakage','missing','manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EventStatus" AS ENUM ('DRAFT','READY_FOR_WAREHOUSE','SENT_TO_WAREHOUSE','ISSUED','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReservationState" AS ENUM ('draft','confirmed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "role" "Role" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "parent_id" uuid NULL REFERENCES "categories"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "categories_parent_id_name_key" UNIQUE ("parent_id","name")
);

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "unit" text NOT NULL DEFAULT 'ks',
  "image_url" text NULL,
  "active" boolean NOT NULL DEFAULT true,
  "return_delay_days" int NOT NULL DEFAULT 0,
  "sku" text NULL UNIQUE,
  "notes" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_items_return_delay_days_check" CHECK ("return_delay_days" >= 0)
);

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "location" text NOT NULL,
  "delivery_datetime" timestamptz NOT NULL,
  "pickup_datetime" timestamptz NOT NULL,
  "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
  "export_needs_revision" boolean NOT NULL DEFAULT false,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "events_interval_check" CHECK ("delivery_datetime" < "pickup_datetime")
);

CREATE TABLE IF NOT EXISTS "event_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "reserved_quantity" int NOT NULL,
  "state" "ReservationState" NOT NULL DEFAULT 'draft',
  "expires_at" timestamptz NULL,
  CONSTRAINT "event_reservations_event_id_inventory_item_id_key" UNIQUE ("event_id","inventory_item_id"),
  CONSTRAINT "event_reservations_reserved_quantity_check" CHECK ("reserved_quantity" >= 0)
);

CREATE TABLE IF NOT EXISTS "event_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "version" int NOT NULL,
  "exported_at" timestamptz NOT NULL,
  "exported_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "snapshot_json" jsonb NOT NULL,
  "pdf_path" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_exports_event_id_version_key" UNIQUE ("event_id","version")
);

CREATE TABLE IF NOT EXISTS "event_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "issued_quantity" int NOT NULL,
  "issued_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "idempotency_key" text NOT NULL UNIQUE,
  CONSTRAINT "event_issues_issued_quantity_check" CHECK ("issued_quantity" >= 0)
);

CREATE TABLE IF NOT EXISTS "event_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "returned_quantity" int NOT NULL,
  "broken_quantity" int NOT NULL DEFAULT 0,
  "returned_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "returned_at" timestamptz NOT NULL DEFAULT now(),
  "idempotency_key" text NOT NULL UNIQUE,
  CONSTRAINT "event_returns_returned_quantity_check" CHECK ("returned_quantity" >= 0),
  CONSTRAINT "event_returns_broken_quantity_check" CHECK ("broken_quantity" >= 0)
);

CREATE TABLE IF NOT EXISTS "inventory_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "delta_quantity" int NOT NULL,
  "reason" "LedgerReason" NOT NULL,
  "event_id" uuid NULL REFERENCES "events"("id") ON DELETE SET NULL,
  "note" text NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "diff_json" jsonb NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Recommended indexes
CREATE INDEX IF NOT EXISTS "idx_events_delivery" ON "events"("delivery_datetime");
CREATE INDEX IF NOT EXISTS "idx_events_pickup" ON "events"("pickup_datetime");

CREATE INDEX IF NOT EXISTS "idx_res_event_item" ON "event_reservations"("event_id","inventory_item_id");
CREATE INDEX IF NOT EXISTS "idx_res_item" ON "event_reservations"("inventory_item_id");
CREATE INDEX IF NOT EXISTS "idx_res_state_exp" ON "event_reservations"("state","expires_at");

CREATE INDEX IF NOT EXISTS "idx_ledger_item" ON "inventory_ledger"("inventory_item_id");
CREATE INDEX IF NOT EXISTS "idx_cat_parent" ON "categories"("parent_id");
CREATE INDEX IF NOT EXISTS "idx_exports_event_version" ON "event_exports"("event_id","version" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_entity" ON "audit_log"("entity_type","entity_id");

-- Optional partial index for performance on confirmed reservations
CREATE INDEX IF NOT EXISTS "idx_res_item_confirmed" ON "event_reservations"("inventory_item_id") WHERE state = 'confirmed';

