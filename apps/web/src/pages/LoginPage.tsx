import { useState } from "react";
import { api, setCurrentUser, setToken } from "../lib/api";
import { useNavigate } from "react-router-dom";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import toast from "react-hot-toast";
import { humanError } from "../lib/viewModel";
import { Icons } from "../lib/icons";

const DEMO_USERS = [
  { name: "Event Manager", email: "em@local", pass: "em123", role: "Manager", color: "bg-purple-100 text-purple-600" },
  { name: "Skladník", email: "warehouse@local", pass: "wh123", role: "Sklad", color: "bg-orange-100 text-orange-600" },
  { name: "Kuchař", email: "chef@local", pass: "chef123", role: "Kuchyně", color: "bg-green-100 text-green-600" },
  { name: "Admin", email: "admin@local", pass: "admin123", role: "Admin", color: "bg-blue-100 text-blue-600" },
];

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e?: React.FormEvent, creds?: { email: string; pass: string }) => {
    e?.preventDefault();
    if (isLoading) return;

    const loginEmail = creds?.email || email;
    const loginPass = creds?.pass || password;

    if (!loginEmail || !loginPass) {
      toast.error("Vyplňte prosím přihlašovací údaje");
      return;
    }

    setIsLoading(true);
    try {
      const res = await api<{ token: string; user: { id: string; email: string; role: string } }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email: loginEmail, password: loginPass })
        }
      );
      setToken(res.token);
      setCurrentUser(res.user);
      toast.success("Vítejte zpět!");
      // Redirect based on role
      if (res.user.role === 'warehouse') {
        nav("/warehouse");
      } else {
        nav("/events");
      }
    } catch (e: any) {
      const msg = humanError(e);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="text-center mb-10">
          <div className="mx-auto w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mb-5 shadow-lg shadow-indigo-200">
            <Icons.Box />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Cater sklad</h1>
          <p className="text-gray-500 mt-2 text-sm">Vyberte uživatele pro přihlášení</p>
        </div>

        {!showManual ? (
          <div className="space-y-3 animation-fade-in">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                onClick={() => handleLogin(undefined, { email: u.email, pass: u.pass })}
                disabled={isLoading}
                className="w-full flex items-center p-4 border border-gray-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all group disabled:opacity-50 disabled:cursor-not-allowed text-left bg-white shadow-sm"
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mr-4 ${u.color}`}>
                  {u.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900 group-hover:text-indigo-700">{u.name}</div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                    {u.role}
                  </div>
                </div>
                <div className="text-gray-300 group-hover:text-indigo-500 transition-colors">
                  {isLoading ? '...' : '→'}
                </div>
              </button>
            ))}

            <div className="pt-6 mt-6 border-t border-gray-100 text-center">
              <button
                onClick={() => setShowManual(true)}
                className="text-xs font-medium text-gray-400 hover:text-indigo-600 transition-colors flex items-center justify-center gap-1 mx-auto"
              >
                <Icons.User /> Jiný uživatel
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4 animation-fade-in">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Email</label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Heslo</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button full disabled={isLoading} variant="primary">
                {isLoading ? 'Přihlašování...' : 'Přihlásit se'}
              </Button>
            </div>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setShowManual(false)}
                className="text-sm text-gray-500 hover:text-gray-900 font-medium"
              >
                Zpět na výběr uživatele
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
