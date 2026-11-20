-- Null zachovává požadované množství u rozpracovaných výdejů ze starších verzí.
ALTER TABLE "event_packing"
  ADD COLUMN "packed_quantity" INTEGER CHECK ("packed_quantity" >= 0);
