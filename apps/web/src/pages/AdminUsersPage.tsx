import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../lib/api";

export default function AdminUsersPage() {
  const role = getCurrentUser()?.role ?? "";
  const [users, setUsers] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userRole, setUserRole] = useState("event_manager");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api<{ users: any[] }>("/admin/users");
    setUsers(res.users);
  };

  useEffect(() => {
    if (role === "admin") load().catch(() => {});
  }, [role]);

  if (role !== "admin") return <div className="rounded border bg-white p-4 text-sm">Pouze admin.</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Uživatelé</h1>
      <div className="rounded border bg-white p-4">
        <div className="mb-2 font-medium">Nový uživatel</div>
        <form
          className="grid gap-2 md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/admin/users", {
                method: "POST",
                body: JSON.stringify({ email, password, role: userRole })
              });
              setEmail("");
              setPassword("");
              await load();
            } catch (e: any) {
              setError(e?.error?.message ?? "Create failed");
            }
          }}
        >
          <label className="text-xs md:col-span-2">
            Email
            <input className="mt-1 w-full rounded border px-2 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="text-xs">
            Role
            <select className="mt-1 w-full rounded border px-2 py-2 text-sm" value={userRole} onChange={(e) => setUserRole(e.target.value)}>
              <option value="admin">admin</option>
              <option value="event_manager">event_manager</option>
              <option value="chef">chef</option>
              <option value="warehouse">warehouse</option>
            </select>
          </label>
          <label className="text-xs">
            Password
            <input className="mt-1 w-full rounded border px-2 py-2 text-sm" value={password} type="password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? <div className="md:col-span-4 text-sm text-red-600">{error}</div> : null}
          <div className="md:col-span-4">
            <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Vytvořit</button>
          </div>
        </form>
      </div>

      <div className="rounded border bg-white">
        <div className="grid grid-cols-12 border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
          <div className="col-span-7">Email</div>
          <div className="col-span-5">Role</div>
        </div>
        {users.map((u) => (
          <div key={u.id} className="grid grid-cols-12 border-b px-3 py-2 text-sm">
            <div className="col-span-7">{u.email}</div>
            <div className="col-span-5 text-slate-600">{u.role}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

