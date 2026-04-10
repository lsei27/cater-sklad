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

export function statusBadgeClass(status: string) {
  switch (status) {
    case "DRAFT":
      return "bg-slate-100 text-slate-700";
    case "READY_FOR_WAREHOUSE":
      return "bg-sky-100 text-sky-700";
    case "SENT_TO_WAREHOUSE":
      return "bg-emerald-100 text-emerald-700";
    case "ISSUED":
      return "bg-amber-100 text-amber-800";
    case "CLOSED":
      return "bg-blue-100 text-blue-700";
    case "CANCELLED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
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

export function managerLabel(user?: { name?: string | null; email?: string | null; id?: string | null }) {
  if (!user) return "";
  const name = user.name?.trim();
  const email = user.email?.trim();
  return name || email || "";
}

export function compareByCategoryParentName(a: any, b: any) {
  const categoryA = String(
    a?.category?.sub?.name ??
      a?.category?.name ??
      (typeof a?.category === "string" ? a.category : undefined) ??
      a?.sub ??
      ""
  );
  const categoryB = String(
    b?.category?.sub?.name ??
      b?.category?.name ??
      (typeof b?.category === "string" ? b.category : undefined) ??
      b?.sub ??
      ""
  );
  const byCategory = categoryA.localeCompare(categoryB, "cs");
  if (byCategory !== 0) return byCategory;

  const parentA = String(a?.category?.parent?.name ?? a?.parentCategory ?? a?.parentName ?? a?.parent ?? "");
  const parentB = String(b?.category?.parent?.name ?? b?.parentCategory ?? b?.parentName ?? b?.parent ?? "");
  const byParent = parentA.localeCompare(parentB, "cs");
  if (byParent !== 0) return byParent;

  const nameA = String(a?.item?.name ?? a?.name ?? "");
  const nameB = String(b?.item?.name ?? b?.name ?? "");
  return nameA.localeCompare(nameB, "cs");
}

export function formatCategoryParentLabel(category?: string | null, parent?: string | null) {
  const categoryLabel = String(category ?? "").trim();
  const parentLabel = String(parent ?? "").trim();
  if (categoryLabel && parentLabel) return `${categoryLabel} / ${parentLabel}`;
  return categoryLabel || parentLabel;
}
