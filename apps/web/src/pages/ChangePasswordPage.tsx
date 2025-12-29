import { useState } from "react";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Icons } from "../lib/icons";

export default function ChangePasswordPage() {
    const nav = useNavigate();
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error("Nová hesla se neshodují.");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("Heslo musí mít alespoň 6 znaků.");
            return;
        }

        setLoading(true);
        try {
            await api("/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ oldPassword, newPassword })
            });
            toast.success("Heslo úspěšně změněno.");
            setOldPassword("");
            setNewPassword("");
            setConfirmPassword("");
            nav("/settings");
        } catch (e: any) {
            toast.error(e?.error?.message ?? "Změna hesla selhala.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-md mx-auto space-y-4">
            <div>
                <h1 className="text-xl font-semibold">Změna hesla</h1>
                <div className="text-sm text-slate-600">Zadejte své současné a nové heslo.</div>
            </div>

            <Card>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <label className="block text-sm font-medium">
                            Současné heslo
                            <div className="relative mt-1">
                                <Input
                                    type={showOldPassword ? "text" : "password"}
                                    className="pr-16"
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
                                    onClick={() => setShowOldPassword((prev) => !prev)}
                                >
                                    {showOldPassword ? "Skrýt" : "Zobrazit"}
                                </button>
                            </div>
                        </label>
                        <label className="block text-sm font-medium">
                            Nové heslo
                            <div className="relative mt-1">
                                <Input
                                    type={showNewPassword ? "text" : "password"}
                                    className="pr-16"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
                                    onClick={() => setShowNewPassword((prev) => !prev)}
                                >
                                    {showNewPassword ? "Skrýt" : "Zobrazit"}
                                </button>
                            </div>
                        </label>
                        <label className="block text-sm font-medium">
                            Potvrzení nového hesla
                            <div className="relative mt-1">
                                <Input
                                    type={showConfirmPassword ? "text" : "password"}
                                    className="pr-16"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
                                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                                >
                                    {showConfirmPassword ? "Skrýt" : "Zobrazit"}
                                </button>
                            </div>
                        </label>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="secondary" onClick={() => nav("/settings")}>
                                Zrušit
                            </Button>
                            <Button disabled={loading}>
                                {loading ? <Icons.Loading className="animate-spin" /> : "Změnit heslo"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
