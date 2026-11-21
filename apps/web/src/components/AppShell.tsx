import { useEffect, useState } from "react";
import { ArrowLeftRight, Calendar, LogOut, Package, Settings, Star, Truck } from "lucide-react";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { canUseInventoryFavorites, getCurrentUser, getToken, hasStockAccess, setCurrentUser, setToken } from "../lib/api";
import { cn } from "../lib/ui";
import { roleLabel } from "../lib/viewModel";
import toast, { Toaster } from "react-hot-toast";
import { InventoryFavoritesProvider } from "./InventoryFavorites";

function readSession() {
  return { token: getToken(), user: getCurrentUser() };
}

export default function AppShell() {
  const navigate = useNavigate();
  const [{ token, user }, setSession] = useState(readSession);

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === "token" || event.key === "user" || event.key === null)) {
        setSession(readSession());
      }
    };
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, []);

  if (!token) return <Navigate to="/login" replace />;

  const canUseFavorites = canUseInventoryFavorites(user);
  const links = [
    { to: "/events", label: "Akce", icon: Calendar, visible: true },
    { to: "/warehouse", label: "Výdej", icon: Truck, visible: user?.role === "warehouse" || user?.role === "admin" },
    { to: "/inventory", label: "Sklad", icon: Package, visible: true, end: true },
    { to: "/favorites", label: "Oblíbené", icon: Star, visible: canUseFavorites },
    { to: "/inventory/transfers", label: "Přesuny", icon: ArrowLeftRight, visible: hasStockAccess(user) },
    { to: "/settings", label: "Nastavení", icon: Settings, visible: true },
  ].filter((link) => link.visible);
  const showBottomNavOnTablet = links.length > 5;

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    toast.success("Odhlášeno");
    navigate("/login");
  };

  const navigation = (mobile: boolean) =>
    links.map(({ to, label, icon: Icon, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) =>
          cn(
            "flex items-center justify-center rounded-lg font-medium transition-colors",
            mobile ? "min-h-12 flex-1 flex-col gap-1 text-[10px]" : "gap-2 px-3 py-2 text-sm",
            isActive ? "bg-indigo-50 text-indigo-700" : "text-muted hover:bg-canvas hover:text-ink"
          )
        }
      >
        <Icon size={16} aria-hidden="true" />
        {label}
      </NavLink>
    ));

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Toaster
        position="bottom-left"
        containerStyle={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
        toastOptions={{ success: { duration: 2400 } }}
      />
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-[59px] max-w-[1800px] items-center gap-3 px-4 lg:gap-8 lg:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5 text-sm font-bold text-ink sm:text-base">
            <span className="grid size-7 place-items-center rounded-lg bg-indigo-600 text-white">
              <Package size={16} aria-hidden="true" />
            </span>
            IN CATERING sklad
          </Link>
          <nav aria-label="Hlavní navigace" className={cn("hidden items-center gap-1", showBottomNavOnTablet ? "lg:flex" : "md:flex")}>
            {navigation(false)}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {user && (
              <span
                title={user.email}
                className="hidden truncate rounded-full bg-canvas px-2.5 py-1 text-xs text-muted lg:block"
              >
                {roleLabel(user.role)}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700"
              aria-label="Odhlásit se"
              title="Odhlásit se"
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <main className={cn("mx-auto flex w-full max-w-[1800px] flex-1 flex-col px-4 pt-6 pb-24 sm:px-6 lg:px-8", showBottomNavOnTablet ? "lg:pb-8" : "md:pb-8")}>
        {user && canUseFavorites ? (
          <InventoryFavoritesProvider key={user.id} token={token}><Outlet /></InventoryFavoritesProvider>
        ) : <Outlet />}
      </main>
      <nav
        aria-label="Hlavní navigace"
        className={cn("fixed inset-x-0 bottom-0 z-20 flex gap-1 border-t border-line bg-white px-2 pt-1 pb-[calc(.25rem+env(safe-area-inset-bottom))]", showBottomNavOnTablet ? "lg:hidden" : "md:hidden")}
      >
        {navigation(true)}
      </nav>
    </div>
  );
}
