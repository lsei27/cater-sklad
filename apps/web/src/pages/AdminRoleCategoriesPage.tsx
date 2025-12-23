import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Button from "../components/ui/Button";
import toast from "react-hot-toast";
import { Shield, Save } from "lucide-react";
import Skeleton from "../components/ui/Skeleton";

export default function AdminRoleCategoriesPage() {
    const role = getCurrentUser()?.role ?? "";
    const [categories, setCategories] = useState<any[]>([]); // Parents
    const [loading, setLoading] = useState(true);
    const [accessMap, setAccessMap] = useState<Record<string, Set<string>>>({});
    const [saving, setSaving] = useState(false);

    // Roles to manage
    const roles = [
        { id: "event_manager", label: "Event Manager" },
        { id: "chef", label: "Šéfkuchař / Kuchař" },
        { id: "warehouse", label: "Skladník" },
        // Admin has implicit access
    ];

    const load = async () => {
        setLoading(true);
        try {
            // Fetch categories (tree)
            const catRes = await api<{ parents: any[] }>("/categories/tree");
            setCategories(catRes.parents);

            // Fetch access config
            const accessRes = await api<{ access: any[] }>("/admin/role-access");

            const map: Record<string, Set<string>> = {};
            roles.forEach(r => map[r.id] = new Set());

            accessRes.access.forEach((a) => {
                if (!map[a.role]) map[a.role] = new Set();
                map[a.role].add(a.categoryId);
            });
            setAccessMap(map);

        } catch (e: any) {
            toast.error(e?.error?.message ?? "Nepodařilo se načíst data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (role !== "admin") return;
        load().catch(() => { });
    }, [role]);

    const toggle = (roleId: string, catId: string) => {
        setAccessMap(prev => {
            const next = { ...prev };
            const roleSet = new Set(next[roleId]);
            if (roleSet.has(catId)) roleSet.delete(catId);
            else roleSet.add(catId);
            next[roleId] = roleSet;
            return next;
        });
    };

    const saveRole = async (roleId: string) => {
        setSaving(true);
        try {
            const ids = Array.from(accessMap[roleId] ?? new Set());
            await api("/admin/role-access", {
                method: "POST",
                body: JSON.stringify({ role: roleId, category_ids: ids })
            });
            toast.success("Uloženo");
        } catch (e: any) {
            toast.error(e?.error?.message ?? "Chyba při ukládání");
        } finally {
            setSaving(false);
        }
    };

    if (role !== "admin") {
        return <div className="p-4 text-red-500">Přístup odepřen.</div>;
    }

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-xl font-semibold">Oprávnění rolí</h1>
                <div className="text-sm text-slate-600">Přiřaď kategorie (typy), se kterými mohou role pracovat.</div>
            </div>

            {loading ? (
                <Card>
                    <CardContent className="p-6">
                        <Skeleton className="h-6 w-1/3 mb-4" />
                        <Skeleton className="h-20 w-full" />
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {roles.map(r => (
                        <Card key={r.id}>
                            <CardHeader>
                                <div className="flex items-center gap-2 font-semibold">
                                    <Shield className="h-4 w-4" /> {r.label}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {categories.map(cat => (
                                        <label key={cat.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                                            <input
                                                type="checkbox"
                                                checked={accessMap[r.id]?.has(cat.id) ?? false}
                                                onChange={() => toggle(r.id, cat.id)}
                                                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                            />
                                            <span className="text-sm font-medium">{cat.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                                    <Button size="sm" onClick={() => saveRole(r.id)} disabled={saving}>
                                        <Save className="h-3 w-3 mr-1" /> Uložit
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
