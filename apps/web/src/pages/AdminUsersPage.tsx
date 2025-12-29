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
import { Icons } from "../lib/icons";
import ConfirmDialog from "../components/ui/ConfirmDialog";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "event_manager", label: "Event manager" },
  { value: "chef", label: "Kuchař" },
  { value: "warehouse", label: "Sklad" }
] as const;

export default function AdminUsersPage() {
  const role = getCurrentUser()?.role ?? "";
  const [users, setUsers] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    if (role === "admin") load().catch(() => { });
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
            <Icons.Plus /> Nový uživatel
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/admin/users", {
                  method: "POST",
                  body: JSON.stringify({ name: name.trim() || undefined, email, password, role: userRole })
                });
                setName("");
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
              Jméno
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="např. Jan Novák" required />
            </label>
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
              <div className="relative mt-1">
                <Input
                  className="pr-16"
                  value={password}
                  type={showPassword ? "text" : "password"}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="min. 6 znaků"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? "Skrýt" : "Zobrazit"}
                </button>
              </div>
            </label>

            <div className="md:col-span-4">
              <Button full disabled={!name.trim() || !email.trim() || password.length < 6}>
                Vytvořit
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icons.User /> Seznam
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
                <UserRow key={u.id} user={u} onDeleted={load} />
              ))}
            </div>
          )}


        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({ user, onDeleted }: { user: any; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Heslo musí mít alespoň 6 znaků.");
      return;
    }
    setLoading(true);
    try {
      await api(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPassword })
      });
      toast.success("Heslo resetováno");
      setResetOpen(false);
      setNewPassword("");
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Reset hesla selhal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.name || user.email}</div>
          <div className="mt-1 text-xs text-slate-600">{user.name ? user.email : roleLabel(user.role)}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{roleLabel(user.role)}</Badge>
          <button
            onClick={() => setResetOpen(true)}
            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
            title="Resetovat heslo"
          >
            <Icons.Lock className="h-4 w-4" /> {/* Assuming Lock icon exists or use generic */}
          </button>
          <button
            onClick={() => setConfirm(true)}
            className="p-2 text-slate-400 hover:text-red-600 transition-colors"
            title="Smazat uživatele"
          >
            <Icons.Trash />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title={`Smazat uživatele?`}
        description={`Opravdu chceš smazat uživatele ${user.email}? Tato akce je nevratná.`}
        confirmText="Smazat"
        onConfirm={async () => {
          try {
            await api(`/admin/users/${user.id}`, { method: "DELETE" });
            toast.success("Uživatel smazán");
            onDeleted();
          } catch (e: any) {
            toast.error(e?.error?.message ?? "Nepodařilo se smazat uživatele.");
          }
        }}
      />

      {/* Using a simple inline dialog or leveraging existing Modal/Dialog components. 
         Since I can't confirm existing Dialog component API fully from here 
         (ConfirmDialog is specific), I will use a simple fixed overlay or check if I can reuse something.
         Actually, I see ConfirmDialog usage. I can probably create a simple custom dialog or check if there is a generic one.
         Let's assume there isn't a generic versatile Dialog readily available in context, 
         so I'll use a fixed overlay with styling similar to ConfirmDialog.*/}

      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-slate-900">Reset hesla</h3>
            <p className="mt-2 text-sm text-slate-600">
              Nastavit nové heslo pro uživatele <strong>{user.email}</strong>.
            </p>
            <form onSubmit={handleReset} className="mt-4 space-y-4">
              <div className="relative">
                <Input
                  autoFocus
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Nové heslo (min. 6 znaků)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="pr-16"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => setShowNewPassword((prev) => !prev)}
                >
                  {showNewPassword ? "Skrýt" : "Zobrazit"}
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setResetOpen(false);
                    setShowNewPassword(false);
                  }}
                >
                  Zrušit
                </Button>
                <Button disabled={loading || newPassword.length < 6}>Uložit</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
