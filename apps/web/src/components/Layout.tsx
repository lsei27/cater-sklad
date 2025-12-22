import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCurrentUser, getToken, setCurrentUser, setToken } from "../lib/api";
import { useEffect } from "react";

export default function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const token = getToken();
  const user = getCurrentUser();
  useEffect(() => {
    if (!token && loc.pathname !== "/login") nav("/login");
  }, [token, loc.pathname]);
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <button className="font-semibold" onClick={() => nav("/events")}>
              Cater sklad
            </button>
            <button className="text-sm text-slate-600" onClick={() => nav("/inventory")}>
              Inventář
            </button>
            {user?.role === "admin" ? (
              <>
                <button className="text-sm text-slate-600" onClick={() => nav("/admin/import")}>Import CSV</button>
                <button className="text-sm text-slate-600" onClick={() => nav("/admin/categories")}>Kategorie</button>
                <button className="text-sm text-slate-600" onClick={() => nav("/admin/items")}>Položky</button>
                <button className="text-sm text-slate-600" onClick={() => nav("/admin/users")}>Uživatelé</button>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {user ? <div className="text-xs text-slate-600">{user.email} • {user.role}</div> : null}
            {token ? (
              <button
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                onClick={() => {
                  setToken(null);
                  setCurrentUser(null);
                  nav("/login");
                }}
              >
                Odhlásit
              </button>
            ) : (
              <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => nav("/login")}>
                Přihlásit
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
