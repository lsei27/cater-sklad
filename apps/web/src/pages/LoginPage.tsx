import { useState } from "react";
import { api, setCurrentUser, setToken } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import toast from "react-hot-toast";
import { humanError } from "../lib/viewModel";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@local");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto mt-10 max-w-md px-4">
      <Card>
        <CardHeader>
          <div className="text-base font-semibold">Přihlášení</div>
          <div className="mt-1 text-sm text-slate-600">Přístup do interního skladu pro cateringové akce.</div>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const res = await api<{ token: string; user: { id: string; email: string; role: string } }>(
                  "/auth/login",
                  {
                    method: "POST",
                    body: JSON.stringify({ email, password })
                  }
                );
                setToken(res.token);
                setCurrentUser(res.user);
                toast.success("Přihlášeno");
                nav("/events");
              } catch (e: any) {
                const msg = humanError(e);
                setError(msg);
                toast.error(msg);
              }
            }}
          >
            <label className="block text-sm">
              Email
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block text-sm">
              Heslo
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
            <Button full>Pokračovat</Button>
          </form>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
            Demo účty: admin@local/admin123 • em@local/em123 • chef@local/chef123 • warehouse@local/wh123
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
