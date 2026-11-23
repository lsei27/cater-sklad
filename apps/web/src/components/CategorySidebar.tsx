import {
  Armchair,
  Box,
  ChefHat,
  ChevronRight,
  Coffee,
  Flower2,
  Grid2X2,
  Layers,
  Plug,
  Shirt,
  Utensils,
  Wine,
} from "lucide-react";

type Category = { id: string; name: string; _count?: { items: number } };
export type CatalogCategory = Category & { children?: Category[] };

const countFormat = new Intl.NumberFormat("cs-CZ");
const itemCount = (category: CatalogCategory) =>
  (category._count?.items ?? 0) + (category.children ?? []).reduce((sum, child) => sum + (child._count?.items ?? 0), 0);

function categoryIcon(name: string) {
  const key = name.toLocaleLowerCase("cs");
  if (key.includes("mobiliář")) return Armchair;
  if (key.includes("sklo")) return Wine;
  if (key.includes("příbor")) return Utensils;
  if (key.includes("servis")) return Coffee;
  if (key.includes("dekor")) return Flower2;
  if (key.includes("prádlo")) return Shirt;
  if (key.includes("elektro")) return Plug;
  if (key.includes("kuch")) return ChefHat;
  if (key.includes("porcelán")) return Layers;
  return Box;
}

export default function CategorySidebar({
  categories,
  parentId,
  categoryId,
  onParent,
  onCategory,
}: {
  categories: CatalogCategory[];
  parentId: string;
  categoryId: string;
  onParent: (id: string) => void;
  onCategory: (id: string) => void;
}) {
  const selected = categories.find((category) => category.id === parentId);
  return (
    <nav aria-label="Kategorie položek" className="space-y-1">
      <div className="mb-2 px-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Kategorie</div>
      <button
        type="button"
        className="category-link"
        aria-current={!parentId && !categoryId}
        onClick={() => onParent("")}
      >
        <Grid2X2 size={16} /> Vše
        {categories.some((category) => category._count) && (
          <span className="ml-auto text-xs font-normal text-muted">
            {countFormat.format(categories.reduce((sum, category) => sum + itemCount(category), 0))}
          </span>
        )}
      </button>
      {categories.map((category) => {
        const Icon = categoryIcon(category.name);
        return (
          <button
            key={category.id}
            type="button"
            className="category-link"
            aria-current={parentId === category.id}
            onClick={() => onParent(category.id)}
          >
            <Icon size={16} className="shrink-0" /> <span className="min-w-0 wrap-break-word">{category.name}</span>
            {category._count && (
              <span className="ml-auto text-xs font-normal text-muted">{countFormat.format(itemCount(category))}</span>
            )}
          </button>
        );
      })}
      {!!selected?.children?.length && (
        <div className="mt-2 space-y-0.5 border-l border-line pl-2">
          <button type="button" className="category-link" aria-current={!categoryId} onClick={() => onCategory("")}>
            Vše v kategorii
          </button>
          {selected.children.map((category) => (
            <button
              key={category.id}
              type="button"
              className="category-link"
              aria-current={categoryId === category.id}
              onClick={() => onCategory(category.id)}
            >
              <ChevronRight size={12} className="shrink-0" /> {category.name}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
