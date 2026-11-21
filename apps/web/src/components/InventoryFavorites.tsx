import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import toast from "react-hot-toast";
import { api, getToken } from "../lib/api";
import { cn } from "../lib/ui";
import { humanError } from "../lib/viewModel";
import Button from "./ui/Button";

type InventoryFavorites = {
  ids: ReadonlySet<string> | null;
  loadFailed: boolean;
  retry: () => void;
  pendingIds: ReadonlySet<string>;
  toggle: (itemId: string) => Promise<void>;
};

const FavoritesContext = createContext<InventoryFavorites | null>(null);
const favoritesPath = "/inventory/favorites";

export function InventoryFavoritesProvider({ children, token }: { children: ReactNode; token: string }) {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (ids) return;
    const controller = new AbortController();
    api<{ itemIds: string[] }>(favoritesPath, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(({ itemIds }) => {
        if (controller.signal.aborted) return;
        setLoadFailed(false);
        setIds(new Set(itemIds));
      })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [attempt, ids, token]);

  const retry = () => {
    setLoadFailed(false);
    setAttempt((current) => current + 1);
  };

  const toggle = async (itemId: string) => {
    if (!ids || pendingIds.has(itemId) || token !== getToken()) return;
    const add = !ids.has(itemId);
    setPendingIds((current) => new Set(current).add(itemId));
    try {
      await api(`${favoritesPath}/${itemId}`, {
        method: add ? "PUT" : "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      setIds((current) => {
        const next = new Set(current);
        if (add) next.add(itemId);
        else next.delete(itemId);
        return next;
      });
    } catch (error) {
      toast.error(humanError(error));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  };

  return <FavoritesContext.Provider value={{ ids, loadFailed, retry, pendingIds, toggle }}>{children}</FavoritesContext.Provider>;
}

export function useInventoryFavorites() {
  return useContext(FavoritesContext);
}

export function FavoriteButton({ itemId, itemName, showLabel = false, className }: {
  itemId: string;
  itemName: string;
  showLabel?: boolean;
  className?: string;
}) {
  const favorites = useInventoryFavorites();
  if (!favorites) return null;
  const selected = favorites.ids?.has(itemId) ?? false;
  const action = selected ? "Odebrat z oblíbených" : "Přidat do oblíbených";

  return (
    <Button
      type="button"
      variant={showLabel ? "secondary" : "ghost"}
      size="sm"
      className={cn(
        showLabel ? "h-auto min-h-9 justify-start gap-1.5 px-2 py-1 text-left text-xs leading-tight" : "size-9 shrink-0 p-0",
        !showLabel && "text-muted",
        selected && "bg-amber-50 text-amber-700 hover:bg-amber-100",
        className
      )}
      aria-label={`${showLabel ? action : "Oblíbená položka"} · ${itemName}`}
      aria-pressed={showLabel ? undefined : selected}
      title={showLabel ? undefined : action}
      disabled={!favorites.ids || favorites.pendingIds.has(itemId)}
      onClick={() => void favorites.toggle(itemId)}
    >
      <Star size={showLabel ? 15 : 17} aria-hidden="true" className={cn("shrink-0", selected && "fill-current")} />
      {showLabel && <span>{action}</span>}
    </Button>
  );
}

export function FavoriteFilter({ selected, onChange }: { selected: boolean; onChange: (selected: boolean) => void }) {
  const favorites = useInventoryFavorites();
  if (!favorites) return null;
  if (favorites.loadFailed) return <FavoritesLoadError />;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={selected}
      disabled={!favorites.ids}
      className="shrink-0 aria-pressed:border-indigo-200 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700"
      onClick={() => onChange(!selected)}
    >
      <Star size={15} aria-hidden="true" className={selected ? "fill-current" : undefined} /> Oblíbené
    </Button>
  );
}

export function FavoritesLoadError() {
  const favorites = useInventoryFavorites();
  if (!favorites?.loadFailed) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <p role="alert" className="text-red-700">Oblíbené se nepodařilo načíst.</p>
      <Button type="button" variant="secondary" size="sm" onClick={favorites.retry}>Zkusit znovu</Button>
    </div>
  );
}
