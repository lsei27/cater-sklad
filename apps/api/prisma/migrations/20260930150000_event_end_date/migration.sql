-- Dny vícedenní akce se počítají z data akce od-do (event_date .. event_end_date),
-- ne ze závozu a svozu. Svoz je běžně druhý den ráno, takže se podle něj
-- jako vícedenní tvářily i obyčejné jednodenní akce.
--
-- Migrace je psaná idempotentně (IF NOT EXISTS / OR REPLACE), stejně jako
-- 20260930090000_multi_day_rows.
--
-- Staré funkce event_day_count/start/end(delivery, pickup, ...) se NEMAŽOU:
-- během nasazení ještě chvíli běží stará verze API, která je volá. Nový kód je
-- nepoužívá a smažou se v pozdější migraci.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "event_end_date" TIMESTAMPTZ(6);

-- event_date a event_end_date jsou kalendářní data uložená jako půlnoc UTC,
-- proto se datum bere z UTC hodnoty. Bez konce (nebo s koncem před začátkem)
-- je akce jednodenní.
CREATE OR REPLACE FUNCTION event_row_day_count(e events)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN e.event_date IS NULL OR e.event_end_date IS NULL THEN 1
    WHEN (e.event_end_date AT TIME ZONE 'UTC')::date <= (e.event_date AT TIME ZONE 'UTC')::date THEN 1
    ELSE ((e.event_end_date AT TIME ZONE 'UTC')::date - (e.event_date AT TIME ZONE 'UTC')::date) + 1
  END
$$;

-- Hranice dnů. Den 1 začíná závozem, další dny o půlnoci v Praze,
-- poslední den končí svozem.
CREATE OR REPLACE FUNCTION event_row_day_start(e events, day_no integer)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN day_no IS NULL OR day_no <= 1 THEN e.delivery_datetime
    ELSE (((e.event_date AT TIME ZONE 'UTC')::date + (day_no - 1))::timestamp AT TIME ZONE 'Europe/Prague')
  END
$$;

CREATE OR REPLACE FUNCTION event_row_day_end(e events, day_no integer)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN day_no IS NULL OR day_no >= event_row_day_count(e) THEN e.pickup_datetime
    ELSE (((e.event_date AT TIME ZONE 'UTC')::date + day_no)::timestamp AT TIME ZONE 'Europe/Prague')
  END
$$;
