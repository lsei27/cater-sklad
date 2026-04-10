import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import toast from "react-hot-toast";

type Warehouse = {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
};

export default function AdminWarehousesPage() {
  const [items, setItems] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Use the generic /warehouses route with all=true for admins
      const r = await api<{ warehouses: Warehouse[] }>("/warehouses?all=true");
      setItems(r.warehouses);
    } catch (e: any) {
      toast.error("Chyba načítání: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleEdit = (w: Warehouse) => {
    setEditId(w.id);
    setName(w.name);
    setAddress(w.address ?? "");
    setActive(w.active);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditId(null);
    setName("");
    setAddress("");
    setActive(true);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Zadejte název skladu");
    setSaving(true);
    try {
      if (editId) {
        await api(`/admin/warehouses/${editId}`, {
          method: "PUT",
          body: JSON.stringify({
            name: name.trim(),
            address: address.trim() || undefined,
            active
          })
        });
        toast.success("Sklad upraven");
      } else {
        await api("/admin/warehouses", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            address: address.trim() || undefined
          })
        });
        toast.success("Sklad vytvořen");
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      toast.error("Chyba ukládání: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Správa skladů</h1>
          <p className="text-gray-500 mt-1">Seznam všech fyzických skladů v systému.</p>
        </div>
        <Button onClick={handleCreate}>+ Vytvořit sklad</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Název skladu</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Adresa</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Aktivní</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Akce</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={4} className="px-6 py-4 text-center text-gray-500">Načítám...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-4 text-center text-gray-500">Zatím žádné sklady.</td></tr>
                ) : (
                  items.map(w => (
                    <tr key={w.id} className={w.active ? "" : "opacity-50"}>
                      <td className="px-6 py-4 font-semibold text-gray-900">{w.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{w.address || "-"}</td>
                      <td className="px-6 py-4 text-right">
                        {w.active ? <span className="text-green-600 font-bold text-sm">Ano</span> : <span className="text-red-600 font-bold text-sm">Ne</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="secondary" size="sm" onClick={() => handleEdit(w)}>Upravit</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editId ? "Upravit sklad" : "Nový sklad"}>
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Název skladu</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="např. Hlavní sklad" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Adresa (volitelné)</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="např. Křižíkova 123" />
          </div>
          {editId && (
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-sm text-gray-700 font-medium">Aktivní (zobrazuje se ve výběru)</span>
            </label>
          )}
          <div className="pt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Zrušit</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Ukládám..." : "Uložit"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
