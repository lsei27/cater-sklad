import { Link } from "react-router-dom";
import { getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import { roleLabel } from "../lib/viewModel";
import { FileUp, Layers3, Package, Users, ShieldAlert } from "lucide-react";

function Tile(props: { to: string; title: string; desc: string; icon: any }) {
  const Icon = props.icon;
  return (
    <Link to={props.to} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-slate-900 p-2 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{props.title}</div>
          <div className="mt-1 text-sm text-slate-600">{props.desc}</div>
        </div>
      </div>
    </Link>
  );
}

export default function SettingsPage() {
  const role = getCurrentUser()?.role ?? "";
  const isAdmin = role === "admin";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Nastavení</h1>
          <div className="text-sm text-slate-600">Správa aplikace a účtu.</div>
        </div>
        <Badge>{roleLabel(role)}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {isAdmin && (
          <>
            <Tile to="/settings/categories" title="Kategorie" desc="Strom typů a podkategorií." icon={Layers3} />
            <Tile to="/settings/roles" title="Oprávnění rolí" desc="Přiřazení kategorií k rolím (Kuchyň, atd.)" icon={ShieldAlert} />
            <Tile to="/settings/items" title="Položky" desc="Názvy, obrázky, aktivita, jednotky." icon={Package} />
            <Tile to="/settings/items?import=true" title="Import CSV" desc="Hromadné založení a aktualizace." icon={FileUp} />
            <Tile to="/settings/users" title="Uživatelé" desc="Role a přístupy." icon={Users} />
          </>
        )}
        <Tile to="/settings/password" title="Změna hesla" desc="Změna přihlašovacího hesla." icon={ShieldAlert} />
      </div>
    </div>
  );
}

