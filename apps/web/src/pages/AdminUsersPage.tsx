import { useEffect, useState } from "react";
import { api, getCurrentUser, type ApiError } from "../lib/api";
import { Card, CardContent } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import toast from "react-hot-toast";
import { roleLabel } from "../lib/viewModel";
import { Icons } from "../lib/icons";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Modal from "../components/ui/Modal";
import { Search, UserPlus } from "lucide-react";
import { cn } from "../lib/ui";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "event_manager", label: "Event manager" },
  { value: "chef", label: "Kuchař" },
  { value: "warehouse", label: "Sklad" },
] as const;

type UserRole = (typeof ROLE_OPTIONS)[number]["value"];
type AdminUser = { id: string; email: string; name: string | null; role: UserRole; canStocktake: boolean };

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  event_manager: "Zakládá akce, přidává položky a předává je skladu.",
  warehouse: "Vychystává, vydává a přijímá položky zpět. Může provádět přesuny.",
  chef: "Přidává a potvrzuje položky kuchyně.",
  admin: "Spravuje aplikaci, uživatele a oprávnění.",
};

export default function AdminUsersPage() {
  const currentUser = getCurrentUser();
  const role = currentUser?.role ?? "";
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<UserRole | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>("event_manager");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api<{ users: AdminUser[] }>("/admin/users");
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

  const term = search.trim().toLocaleLowerCase("cs");
  const filtered = users.filter(
    (user) =>
      (filter === "all" || user.role === filter) &&
      [user.name ?? "", user.email].some((value) => value.toLocaleLowerCase("cs").includes(term))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Uživatelé</h1>
          <p className="page-description">{users.length} uživatelů · Správa přístupů a rolí</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus size={16} /> Nový uživatel
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-80">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            aria-label="Hledat uživatele"
            placeholder="Hledat jméno nebo e-mail…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {(
          [
            { value: "all", label: "Všichni" },
            ...[...ROLE_OPTIONS].sort((a, b) => Number(a.value === "admin") - Number(b.value === "admin")),
          ] as const
        ).map(({ value, label }) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "min-h-9 rounded-full border border-line bg-white px-3 text-[13px] font-medium",
              filter === value && "border-ink bg-ink text-white"
            )}
          >
            {label} {value === "all" ? users.length : users.filter((user) => user.role === value).length}
          </button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[550px] text-left text-sm">
          <thead className="table-header">
            <tr>
              <th scope="col">Uživatel</th>
              <th scope="col">Role</th>
              <th scope="col">Oprávnění navíc</th>
              <th scope="col" className="text-right">
                Akce
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {loading ? (
              Array.from({ length: 4 }, (_, index) => (
                <tr key={index}>
                  <td colSpan={4} className="p-3">
                    <Skeleton className="h-7 w-full" />
                  </td>
                </tr>
              ))
            ) : filtered.length ? (
              filtered.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  self={user.id === currentUser?.id}
                  onDeleted={load}
                  onUpdated={(updated) =>
                    setUsers((previous) => previous.map((row) => (row.id === updated.id ? updated : row)))
                  }
                />
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-4 text-muted">
                  Žádní uživatelé neodpovídají filtrům.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["event_manager", "warehouse", "chef", "admin"] as const).map((role) => (
          <Card key={role} className="p-3.5">
            <h2 className="text-sm font-semibold">{roleLabel(role)}</h2>
            <p className="mt-1 text-xs text-muted">{ROLE_DESCRIPTIONS[role]}</p>
          </Card>
        ))}
      </div>
      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
        }}
        title="Nový uživatel"
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (creating) return;
            setCreating(true);
            try {
              await api("/admin/users", {
                method: "POST",
                body: JSON.stringify({ name: name.trim() || undefined, email, password, role: userRole }),
              });
              setName("");
              setEmail("");
              setPassword("");
              setShowPassword(false);
              setCreateOpen(false);
              toast.success("Uživatel vytvořen");
              await load();
            } catch (err) {
              toast.error((err as ApiError)?.error?.message ?? "Nepodařilo se vytvořit uživatele.");
            } finally {
              setCreating(false);
            }
          }}
        >
          <label className="text-sm">
            Jméno
            <Input
              className="mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="např. Jan Novák"
              required
            />
          </label>
          <label className="text-sm">
            Email
            <Input
              className="mt-1"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="např. kuchar@firma.cz"
            />
          </label>
          <label className="text-sm">
            Role
            <Select className="mt-1" value={userRole} onChange={(e) => setUserRole(e.target.value as UserRole)}>
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
                required
                minLength={6}
                autoComplete="new-password"
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

          <div className="sm:col-span-2">
            <Button full disabled={creating || !name.trim() || !email.trim() || password.length < 6}>
              Vytvořit
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function UserRow({
  user,
  self,
  onDeleted,
  onUpdated,
}: {
  user: AdminUser;
  self: boolean;
  onDeleted: () => void;
  onUpdated: (user: AdminUser) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Admin a sklad inventuru a přesuny smí vždy, přepínač má smysl jen u ostatních rolí.
  const showStocktakeToggle = user.role !== "admin" && user.role !== "warehouse";

  const toggleStocktake = async (next: boolean) => {
    if (updating) return;
    setUpdating(true);
    try {
      const response = await api<{ user: AdminUser }>(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ can_stocktake: next }),
      });
      onUpdated(response.user);
      toast.success(next ? "Inventura a přesuny povoleny" : "Inventura a přesuny zakázány");
    } catch (err) {
      toast.error((err as ApiError)?.error?.message ?? "Nepodařilo se změnit oprávnění.");
    } finally {
      setUpdating(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (newPassword.length < 6) {
      toast.error("Heslo musí mít alespoň 6 znaků.");
      return;
    }
    setLoading(true);
    try {
      await api(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPassword }),
      });
      toast.success("Heslo resetováno");
      setResetOpen(false);
      setNewPassword("");
      setShowNewPassword(false);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Reset hesla selhal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <tr className="hover:bg-table">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700"
            >
              {(user.name || user.email)
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toLocaleUpperCase("cs")}
            </span>
            <div className="min-w-0 wrap-break-word">
              <div className="font-semibold">{user.name || user.email}</div>
              {user.name && <div className="text-xs text-muted">{user.email}</div>}
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5">
          {self ? (
            <Badge>{roleLabel(user.role)}</Badge>
          ) : (
            <Select
              className="h-8 w-auto min-w-24"
              aria-label={`Role účtu ${user.email}`}
              value={user.role}
              disabled={updating}
              onChange={async (event) => {
                const role = event.target.value as UserRole;
                setUpdating(true);
                try {
                  const response = await api<{ user: AdminUser }>(`/admin/users/${user.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ role }),
                  });
                  onUpdated(response.user);
                  toast.success("Role změněna");
                } catch (err) {
                  toast.error((err as ApiError)?.error?.message ?? "Nepodařilo se změnit roli.");
                } finally {
                  setUpdating(false);
                }
              }}
            >
              {ROLE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </td>
        <td className="px-4 py-2.5">
          {showStocktakeToggle ? (
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
              <input
                type="checkbox"
                checked={user.canStocktake}
                disabled={updating}
                onChange={(event) => void toggleStocktake(event.target.checked)}
              />{" "}
              Inventura a přesuny
            </label>
          ) : (
            <span className="text-muted">–</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="rounded-md p-2 text-muted hover:bg-indigo-50 hover:text-indigo-700"
              title="Resetovat heslo"
              aria-label={`Resetovat heslo účtu ${user.email}`}
            >
              <Icons.Lock className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="rounded-md p-2 text-muted hover:bg-red-50 hover:text-red-700"
              title="Smazat uživatele"
              aria-label={`Smazat účet ${user.email}`}
            >
              <Icons.Trash />
            </button>
          </div>
        </td>
      </tr>

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

      <Modal
        open={resetOpen}
        onOpenChange={(open) => {
          if (loading) return;
          setResetOpen(open);
          if (!open) {
            setNewPassword("");
            setShowNewPassword(false);
          }
        }}
        title="Reset hesla"
        description={"Nastavit nové heslo pro uživatele " + user.email + "."}
      >
        <form onSubmit={handleReset} className="space-y-4">
          <div className="relative">
            <Input
              aria-label="Nové heslo"
              autoComplete="new-password"
              autoFocus
              type={showNewPassword ? "text" : "password"}
              placeholder="Nové heslo (min. 6 znaků)"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={6}
              className="pr-16"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
              onClick={() => setShowNewPassword(!showNewPassword)}
            >
              {showNewPassword ? "Skrýt" : "Zobrazit"}
            </button>
          </div>
          <Button disabled={loading || newPassword.length < 6}>Uložit nové heslo</Button>
        </form>
      </Modal>
    </>
  );
}
