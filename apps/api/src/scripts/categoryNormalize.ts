const MAIN_CATEGORY_ALIASES: Record<string, string> = {
  "dekorace": "Dekorace",
  "elektro": "Elektro",
  "inventar": "Inventář",
  "inventář": "Inventář",
  "inventar servis": "Inventář servis",
  "inventář servis": "Inventář servis",
  "kuchyn": "Kuchyň",
  "kuchyň": "Kuchyň",
  "kuchyne": "Kuchyň",
  "kuchyně": "Kuchyň",
  "kuchn": "Kuchyň",
  "kuchň": "Kuchyň",
  "mobiliar": "Mobiliář",
  "mobiliař": "Mobiliář",
  "mobiliář": "Mobiliář",
  "napisy": "Nápisy",
  "nápisy": "Nápisy",
  "porcelan": "Porcelán",
  "porcelán": "Porcelán",
  "pradlo": "Prádlo",
  "prádlo": "Prádlo",
  "pribor": "Příbory",
  "pribory": "Příbory",
  "příbor": "Příbory",
  "příbory": "Příbory",
  "sklo": "Sklo",
  "spotrebni material": "Spotřební materiál",
  "spotřební materiál": "Spotřební materiál",
  "technika": "Technika",
  "zbozi": "Zboží",
  "zboží": "Zboží"
};

export function normalizeMainCategory(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLocaleLowerCase("cs");
  return MAIN_CATEGORY_ALIASES[key] ?? raw;
}

export function normalizeChildCategory(value: unknown): string {
  return String(value ?? "").trim();
}

export const CANONICAL_MAIN_CATEGORIES = Array.from(new Set(Object.values(MAIN_CATEGORY_ALIASES)));
