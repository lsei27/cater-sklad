import { useState } from "react";
import { api, setCurrentUser, setToken } from "../lib/api";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@local");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md rounded bg-white p-6 shadow">
      <h1 className="mb-4 text-xl font-semibold">Login</h1>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const res = await api<{ token: string; user: { id: string; email: string; role: string } }>("/auth/login", {
              method: "POST",
              body: JSON.stringify({ email, password })
            });
            setToken(res.token);
            setCurrentUser(res.user);
            nav("/events");
          } catch (e: any) {
            setError(e?.error?.message ?? "Login failed");
          }
        }}
      >
        <label className="block text-sm">
          Email
          <input className="mt-1 w-full rounded border px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          Heslo
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        <button className="w-full rounded bg-slate-900 px-4 py-2 text-white">Přihlásit</button>
      </form>
      <div className="mt-4 text-xs text-slate-600">
        Seed účty: admin@local/admin123, em@local/em123, chef@local/chef123, warehouse@local/wh123
      </div>
    </div>
  );
}
