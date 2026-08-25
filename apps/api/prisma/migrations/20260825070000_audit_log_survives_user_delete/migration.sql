-- Audit log musí přežít smazání uživatele.
-- Dosud měl actor_user_id ON DELETE RESTRICT, takže uživatele s jakoukoli
-- historií nešlo smazat. Aplikace to obcházela tím, že jeho záznamy v auditu
-- nejdřív smazala, čímž se ztrácela stopa o zásazích do skladu.
-- Nově se sloupec při smazání uživatele vynuluje a záznam zůstane.

ALTER TABLE "audit_log" ALTER COLUMN "actor_user_id" DROP NOT NULL;

ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_user_id_fkey";

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
