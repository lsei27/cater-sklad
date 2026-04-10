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

function categoryParts(value: any) {
  if (value?.category?.sub !== undefined || value?.category?.parent !== undefined) {
    const parent = value?.category?.parent;
    const sub = value?.category?.sub;
    const main = String(
      (typeof parent === "string" ? parent : parent?.name) ??
        (typeof sub === "string" ? sub : sub?.name) ??
        value?.category?.name ??
        ""
    );
    const child = String(
      (typeof parent === "string" || parent) ? ((typeof sub === "string" ? sub : sub?.name) ?? "") : ""
    );
    const mainSort = typeof parent === "object" && parent ? Number(parent.sortOrder) : typeof sub === "object" && sub ? Number(sub.sortOrder) : undefined;
    const childSort = typeof sub === "object" && sub && (typeof parent === "string" || parent) ? Number(sub.sortOrder) : undefined;
    return { main, child, mainSort, childSort };
  }

  if (value?.category && typeof value.category === "object") {
    const childName = String(value?.category?.name ?? "");
    const mainName = String(value?.category?.parent?.name ?? "");
    const mainSort = mainName ? Number(value?.category?.parent?.sortOrder) : Number(value?.category?.sortOrder);
    const childSort = mainName ? Number(value?.category?.sortOrder) : undefined;
    return {
      main: mainName || childName,
      child: mainName ? childName : "",
      mainSort,
      childSort
    };
  }

  const main = String(value?.parentCategory ?? value?.parentName ?? value?.parent ?? "");
  const child = String((typeof value?.category === "string" ? value.category : undefined) ?? value?.sub ?? "");
  return { main: main || child, child: main ? child : "", mainSort: Number(value?.parentSortOrder), childSort: Number(value?.categorySortOrder) };
}

export function compareByCategoryParentName(a: any, b: any) {
  const aParts = categoryParts(a);
  const bParts = categoryParts(b);
  const aMainSort = Number.isFinite(aParts.mainSort) ? aParts.mainSort : undefined;
  const bMainSort = Number.isFinite(bParts.mainSort) ? bParts.mainSort : undefined;
  if (aMainSort !== undefined && bMainSort !== undefined && aMainSort !== bMainSort) {
    return aMainSort - bMainSort;
  }
  const byMain = aParts.main.localeCompare(bParts.main, "cs");
  if (byMain !== 0) return byMain;

  const aChildSort = Number.isFinite(aParts.childSort) ? aParts.childSort : undefined;
  const bChildSort = Number.isFinite(bParts.childSort) ? bParts.childSort : undefined;
  if (aChildSort !== undefined && bChildSort !== undefined && aChildSort !== bChildSort) {
    return aChildSort - bChildSort;
  }
  const byChild = aParts.child.localeCompare(bParts.child, "cs");
  if (byChild !== 0) return byChild;

  const nameA = String(a?.item?.name ?? a?.name ?? "");
  const nameB = String(b?.item?.name ?? b?.name ?? "");
  return nameA.localeCompare(nameB, "cs");
}

export function formatCategoryParentLabel(mainCategory?: string | null, childCategory?: string | null) {
  const mainLabel = String(mainCategory ?? "").trim();
  const childLabel = String(childCategory ?? "").trim();
  if (mainLabel && childLabel) return `${mainLabel} / ${childLabel}`;
  return mainLabel || childLabel;
}
