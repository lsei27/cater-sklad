import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { getCurrentUser, getToken, setCurrentUser, setToken } from "../lib/api";
import { cn } from "../lib/ui";
import { CalendarDays, Home, Package, Settings, LogOut } from "lucide-react";
import Button from "./ui/Button";
import toast, { Toaster } from "react-hot-toast";
import { roleLabel } from "../lib/viewModel";

function NavItem(props: { icon: any; label: string; to: string; active: boolean; mobile?: boolean }) {
  const nav = useNavigate();
  const Icon = props.icon;
  return (
    <button
      onClick={() => nav(props.to)}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium",
        props.active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
        props.mobile && "flex-1 flex-col gap-1 py-2"
      )}
    >
      <Icon className={cn(props.mobile ? "h-5 w-5" : "h-4 w-4")} />
      <span className={cn(props.mobile ? "text-[11px]" : "")}>{props.label}</span>
    </button>
  );
}

export default function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const token = getToken();
  const user = getCurrentUser();

  useEffect(() => {
    if (!token && loc.pathname !== "/login") nav("/login");
  }, [token, loc.pathname]);

  const role = user?.role ?? "";
  const eventsHref = role === "warehouse" ? "/warehouse" : "/events";
  const stockHref = role === "warehouse" || role === "admin" ? "/inventory" : "/inventory";
  const isSettingsAllowed = role === "admin";

  const items = useMemo(() => {
    const base = [
      { icon: CalendarDays, label: "Akce", to: eventsHref },
      { icon: Package, label: "Sklad", to: stockHref }
    ];
    if (isSettingsAllowed) base.push({ icon: Settings, label: "Nastavení", to: "/settings" });
    return base;
  }, [eventsHref, stockHref, isSettingsAllowed]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-right" />

      <div className="mx-auto flex max-w-6xl gap-4 px-4 pb-20 pt-4 md:pb-6">
        <aside className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-4 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold">Cater sklad</div>
              {user ? <div className="mt-1 text-xs text-slate-600">{user.email} • {roleLabel(user.role)}</div> : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-2">
              {items.map((it) => (
                <NavItem key={it.to} icon={it.icon} label={it.label} to={it.to} active={loc.pathname.startsWith(it.to)} />
              ))}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-2">
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setToken(null);
                  setCurrentUser(null);
                  toast.success("Odhlášeno");
                  nav("/login");
                }}
              >
                <LogOut className="h-4 w-4" />
                Odhlásit
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 md:hidden">
            <div>
              <div className="text-sm font-semibold">Cater sklad</div>
              {user ? <div className="text-[11px] text-slate-600">{roleLabel(user.role)}</div> : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setToken(null);
                setCurrentUser(null);
                toast.success("Odhlášeno");
                nav("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
              Odhlásit
            </Button>
          </header>

          <main>
            <Outlet />
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-6xl px-2 py-1">
          {items.map((it) => (
            <NavItem key={it.to} icon={it.icon} label={it.label} to={it.to} active={loc.pathname.startsWith(it.to)} mobile />
          ))}
        </div>
      </nav>
    </div>
  );
}
