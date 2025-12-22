import { z } from "zod";

export const RoleEnum = z.enum(["admin", "event_manager", "chef", "warehouse"]);
export type Role = z.infer<typeof RoleEnum>;

export const EventStatusEnum = z.enum([
  "DRAFT",
  "READY_FOR_WAREHOUSE",
  "SENT_TO_WAREHOUSE",
  "ISSUED",
  "CLOSED"
]);
export type EventStatus = z.infer<typeof EventStatusEnum>;

export const ReservationStateEnum = z.enum(["draft", "confirmed"]);
export type ReservationState = z.infer<typeof ReservationStateEnum>;

export const LedgerReasonEnum = z.enum([
  "purchase",
  "writeoff",
  "audit_adjustment",
  "breakage",
  "missing",
  "manual"
]);
export type LedgerReason = z.infer<typeof LedgerReasonEnum>;

export const ISODateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

