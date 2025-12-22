export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rozpracováno",
  READY_FOR_WAREHOUSE: "Připraveno",
  SENT_TO_WAREHOUSE: "Předáno skladu",
  ISSUED: "Vydáno",
  CLOSED: "Uzavřeno"
};

export function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  event_manager: "Event manager",
  chef: "Kuchař",
  warehouse: "Sklad"
};

export function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role;
}

export function stockTone(available: number) {
  if (available <= 0) return "danger";
  if (available <= 3) return "warn";
  return "ok";
}

export function humanError(err: any) {
  const code = err?.error?.code;
  if (code === "INSUFFICIENT_STOCK") {
    const available = err?.error?.available;
    return `Nedostatečný stav. K dispozici: ${available ?? 0}.`;
  }
  return err?.error?.message ?? "Něco se nepovedlo.";
}
