import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { getCurrentUser, getToken, setCurrentUser, setToken } from "../lib/api";
import { cn } from "../lib/ui";
import { Icons } from "../lib/icons";
import { roleLabel } from "../lib/viewModel";
import toast, { Toaster } from "react-hot-toast";

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
  const stockHref = "/inventory";
  const isSettingsAllowed = role === "admin";

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    toast.success("Odhlášeno");
    nav("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Toaster position="top-right" />

      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <img
                src="https://cdn.prod.website-files.com/683548bebd66499a4ba7c0e5/6847d84467a509304f4b94a7_Favicon.png"
                alt="IN CATERING sklad"
                className="h-6 w-6"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight leading-none cursor-pointer" onClick={() => nav("/")}>
                IN CATERING sklad
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-700`}>
                  <div className={`w-1.5 h-1.5 rounded-full bg-green-500`}></div>
                  Online
                </div>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1 ml-6">
              <button
                onClick={() => nav(eventsHref)}
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                  loc.pathname.startsWith("/events") || loc.pathname.startsWith("/warehouse")
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icons.Calendar />
                Akce
              </button>
              <button
                onClick={() => nav(stockHref)}
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                  loc.pathname.startsWith("/inventory")
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icons.Box />
                Sklad
              </button>
              {isSettingsAllowed && (
                <button
                  onClick={() => nav("/settings")}
                  className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                  loc.pathname.startsWith("/settings")
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                  {/* We can use Icons.Edit as a placeholder for Settings or add a Settings icon later if needed. Using Edit for now as it's generic enough or just text. 
                             Actually, let's use Icons.User for now or just text. */}
                  <span>Nastavení</span>
                </button>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                  {user.email.substring(0, 2).toUpperCase()}
                </div>
                <div className="hidden md:block">
                  <div className="text-sm font-medium text-gray-900 leading-none">{user.email}</div>
                  <div className="text-[10px] text-gray-500 font-bold uppercase mt-1">
                    {roleLabel(user.role)}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 transition-colors"
              title="Odhlásit se"
            >
              <Icons.Logout />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Mobile Navigation Bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white md:hidden pb-safe">
        <div className="flex justify-around items-center h-16">
          <button
            onClick={() => nav(eventsHref)}
            className={cn(
              "flex flex-col items-center justify-center w-full h-full space-y-1",
              (loc.pathname.startsWith("/events") || loc.pathname.startsWith("/warehouse")) ? "text-indigo-600" : "text-gray-500"
            )}
          >
            <Icons.Calendar />
            <span className="text-[10px] font-medium">Akce</span>
          </button>
          <button
            onClick={() => nav(stockHref)}
            className={cn(
              "flex flex-col items-center justify-center w-full h-full space-y-1",
              loc.pathname.startsWith("/inventory") ? "text-indigo-600" : "text-gray-500"
            )}
          >
            <Icons.Box />
            <span className="text-[10px] font-medium">Sklad</span>
          </button>
          {isSettingsAllowed && (
            <button
              onClick={() => nav("/settings")}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full space-y-1",
                loc.pathname.startsWith("/settings") ? "text-indigo-600" : "text-gray-500"
              )}
            >
              <span className="text-lg">⚙</span>
              <span className="text-[10px] font-medium">Nastavení</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
