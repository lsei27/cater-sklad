export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rozpracováno",
  READY_FOR_WAREHOUSE: "Připraveno",
  SENT_TO_WAREHOUSE: "Předáno skladu",
  ISSUED: "Vydáno",
  CLOSED: "Uzavřeno",
  CANCELLED: "Zrušeno"
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
  if (code === "NO_ITEMS_TO_EXPORT") return "V akci nejsou žádné položky k předání.";
  if (code === "NO_ITEMS_TO_ISSUE") return "Export neobsahuje žádné položky k výdeji.";
  if (code === "ITEMS_REQUIRED") return "Pro uzavření vyplň vráceno/rozbito u všech položek.";
  if (code === "ITEMS_INCOMPLETE") return "Nechybí ti v uzavření některé položky?";
  if (code === "PDF_RENDER_FAILED") return "Nepodařilo se vygenerovat PDF. Zkus to prosím znovu.";
  return err?.error?.message ?? "Něco se nepovedlo.";
}
