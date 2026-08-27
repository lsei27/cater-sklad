-- Tabulky skladu, presunu, blokaci a cross-sell vznikly na produkci mimo migrace,
-- takze je minula konvence z 20260114082944_enable_rls. Dorovnavame ji tady.
-- RLS je zapnuta kvuli Supabase linteru, bez politik - aplikace chodi primym
-- spojenim pres Prismu, kde se RLS neuplatnuje.
-- ENABLE ROW LEVEL SECURITY je idempotentni, na uz zapnute tabulce nic neudela.
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cross_sell_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouse_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouse_transfers" ENABLE ROW LEVEL SECURITY;
