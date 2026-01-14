-- Remove permissive RLS policies that cause Supabase linter warnings
-- RLS remains enabled on all tables (which satisfies the linter requirement)
-- Since the application uses direct database connections (not PostgREST API),
-- RLS policies are not needed and removing them eliminates the warnings

DROP POLICY IF EXISTS "Allow all operations on _prisma_migrations" ON "_prisma_migrations";
DROP POLICY IF EXISTS "Allow all operations on audit_log" ON "audit_log";
DROP POLICY IF EXISTS "Allow all operations on categories" ON "categories";
DROP POLICY IF EXISTS "Allow all operations on event_exports" ON "event_exports";
DROP POLICY IF EXISTS "Allow all operations on event_issues" ON "event_issues";
DROP POLICY IF EXISTS "Allow all operations on event_reservations" ON "event_reservations";
DROP POLICY IF EXISTS "Allow all operations on events" ON "events";
DROP POLICY IF EXISTS "Allow all operations on event_returns" ON "event_returns";
DROP POLICY IF EXISTS "Allow all operations on inventory_items" ON "inventory_items";
DROP POLICY IF EXISTS "Allow all operations on inventory_ledger" ON "inventory_ledger";
DROP POLICY IF EXISTS "Allow all operations on role_category_access" ON "role_category_access";
DROP POLICY IF EXISTS "Allow all operations on users" ON "users";
