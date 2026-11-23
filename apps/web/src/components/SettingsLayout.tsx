import { FileUp, KeyRound, Layers3, Package, Settings, ShieldCheck, Users, Warehouse } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { getCurrentUser, hasStockAccess } from "../lib/api";

export default function SettingsLayout() {
  const user = getCurrentUser();
  const admin = user?.role === "admin";
  const catalog = admin || user?.role === "warehouse";
  const location = useLocation();
  const groups = [
    {
      label: "Sklad a katalog",
      links: [
        {
          path: "/settings/items",
          title: catalog ? "Položky" : "Inventura",
          icon: Package,
          visible: hasStockAccess(user),
        },
        { path: "/settings/categories", title: "Kategorie", icon: Layers3, visible: admin },
        { path: "/settings/warehouses", title: "Sklady", icon: Warehouse, visible: catalog },
        { path: "/settings/items?import=true", title: "Import CSV", icon: FileUp, visible: catalog },
      ],
    },
    {
      label: "Přístupy",
      links: [
        { path: "/settings/users", title: "Uživatelé", icon: Users, visible: admin },
        { path: "/settings/roles", title: "Oprávnění rolí", icon: ShieldCheck, visible: admin },
      ],
    },
    {
      label: "Můj účet",
      links: [
        { path: "/settings", title: "Přehled nastavení", icon: Settings, visible: true },
        { path: "/settings/password", title: "Změna hesla", icon: KeyRound, visible: true },
      ],
    },
  ];

  const importOpen = new URLSearchParams(location.search).get("import") === "true";
  const activePath =
    location.pathname === "/settings/items" && importOpen ? "/settings/items?import=true" : location.pathname;

  return (
    <div className="-mx-4 -mt-6 grid flex-1 items-start sm:-mx-6 lg:-mx-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden min-h-full border-r border-line bg-white p-4 lg:block">
        <div className="mb-5 px-1 text-lg font-bold">Nastavení</div>
        <nav aria-label="Nastavení" className="space-y-5">
          {groups.map((group) => {
            const links = group.links.filter((link) => link.visible);
            if (!links.length) return null;
            return (
              <div key={group.label} className="space-y-1">
                <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {group.label}
                </div>
                {links.map(({ path, title, icon: Icon }) => (
                  <Link
                    className="category-link"
                    to={path}
                    key={path}
                    aria-current={activePath === path ? "page" : undefined}
                  >
                    <Icon size={16} /> {title}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        {location.pathname !== "/settings" && (
          <Link to="/settings" className="mb-3 inline-block text-sm text-muted lg:hidden">
            ← Nastavení
          </Link>
        )}
        <Outlet />
      </div>
    </div>
  );
}
