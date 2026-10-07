-- Oprávnění na inventuru a přesuny navíc k roli (např. pro event managera).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_stocktake" BOOLEAN NOT NULL DEFAULT false;
