import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import toast from "react-hot-toast";
import { roleLabel } from "../lib/viewModel";
import { UserPlus, Users } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "event_manager", label: "Event manager" },
  { value: "chef", label: "Kuchař" },
  { value: "warehouse", label: "Sklad" }
] as const;

export default function AdminUsersPage() {
  const role = getCurrentUser()?.role ?? "";
  const [users, setUsers] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userRole, setUserRole] = useState<(typeof ROLE_OPTIONS)[number]["value"]>("event_manager");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api<{ users: any[] }>("/admin/users");
      setUsers(res.users);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se načíst uživatele.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === "admin") load().catch(() => {});
  }, [role]);

  if (role !== "admin") {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-slate-700">Správa uživatelů je dostupná pouze pro administrátora.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Uživatelé</h1>
        <div className="text-sm text-slate-600">Správa přístupů a rolí.</div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4" /> Nový uživatel
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/admin/users", {
                  method: "POST",
                  body: JSON.stringify({ email, password, role: userRole })
                });
                setEmail("");
                setPassword("");
                toast.success("Uživatel vytvořen");
                await load();
              } catch (e: any) {
                toast.error(e?.error?.message ?? "Nepodařilo se vytvořit uživatele.");
              }
            }}
          >
            <label className="text-sm">
              Email
              <Input className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="např. kuchar@firma.cz" />
            </label>
            <label className="text-sm">
              Role
              <Select className="mt-1" value={userRole} onChange={(e) => setUserRole(e.target.value as any)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              Heslo
              <Input className="mt-1" value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="min. 6 znaků" />
            </label>

            <div className="md:col-span-3">
              <Button full disabled={!email.trim() || password.length < 6}>
                Vytvořit
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" /> Seznam
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-sm text-slate-600">Zatím žádní uživatelé.</div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{u.email}</div>
                    <div className="mt-1 text-xs text-slate-600">{roleLabel(u.role)}</div>
                  </div>
                  <Badge tone="neutral">{roleLabel(u.role)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
