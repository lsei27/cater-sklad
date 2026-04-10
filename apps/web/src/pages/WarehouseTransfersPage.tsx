import { useState, useEffect, useCallback } from "react";
import { api, apiUrl } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { Icons } from "../lib/icons";
import toast from "react-hot-toast";
import { cn } from "../lib/ui";
import { compareByCategoryParentName, formatCategoryParentLabel } from "../lib/viewModel";

type Warehouse = {
  id: string;
  name: string;
  active: boolean;
};

type Item = {
  itemId: string;
  name: string;
  unit: string;
  imageUrl?: string;
  category: {
    parent?: { name: string };
    sub: { name: string };
  };
};

export default function WarehouseTransfersPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [fromWh, setFromWh] = useState("");
  const [toWh, setToWh] = useState("");
  const [transferItems, setTransferItems] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [whRes, itemRes, stockRes] = await Promise.all([
        api<{ warehouses: Warehouse[] }>("/warehouses"),
        api<{ items: Item[] }>("/inventory/items?active=true"),
        api<{ stocks: Record<string, Record<string, number>> }>("/inventory/warehouse-stocks")
      ]);
      setWarehouses(whRes.warehouses);
      setItems(itemRes.items);
      setStocks(stockRes.stocks);
    } catch (e) {
      toast.error("Chyba při načítání dat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = items.filter(i => 
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.category.parent?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    i.category.sub.name.toLowerCase().includes(search.toLowerCase())
  ).sort(compareByCategoryParentName);

  const addItemToTransfer = (i: Item) => {
    if (transferItems.find(x => x.itemId === i.itemId)) return;
    setTransferItems([...transferItems, { itemId: i.itemId, name: i.name, qty: 1 }]);
  };

  const removeTransferItem = (itemId: string) => {
    setTransferItems(transferItems.filter(x => x.itemId !== itemId));
  };

  const updateQty = (itemId: string, qty: number) => {
    setTransferItems(transferItems.map(x => x.itemId === itemId ? { ...x, qty: Math.max(1, qty) } : x));
  };

  const handleTransfer = async () => {
    if (!fromWh || !toWh) {
      toast.error("Vyberte zdrojový a cílový sklad");
      return;
    }
    if (fromWh === toWh) {
      toast.error("Zdrojový a cílový sklad musí být odlišné");
      return;
    }
    if (transferItems.length === 0) {
      toast.error("Přidejte položky k převodu");
      return;
    }

    setSubmitting(true);
    try {
      for (const item of transferItems) {
        await api("/inventory/transfers", {
          method: "POST",
          body: JSON.stringify({
            inventory_item_id: item.itemId,
            from_warehouse_id: fromWh,
            to_warehouse_id: toWh,
            quantity: item.qty,
            note: note
          })
        });
      }
      toast.success("Převod byl úspěšně proveden");
      setTransferItems([]);
      setNote("");
      load();
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Chyba při provádění převodu");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Převody mezi sklady</h1>
          <p className="text-gray-500 text-sm">Manuální přesuny zásob a přehled rozmístění</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Transfer Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-premium">
            <CardHeader className="bg-indigo-600 text-white rounded-t-xl py-4 px-6">
              <div className="flex items-center gap-2">
                <Icons.History />
                <h2 className="font-semibold">Nový převod</h2>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Z (Odkud)</label>
                  <Select 
                    value={fromWh} 
                    onChange={(e) => setFromWh(e.target.value)}
                  >
                    <option value="">Vyberte sklad</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">DO (Kam)</label>
                  <Select 
                    value={toWh} 
                    onChange={(e) => setToWh(e.target.value)}
                  >
                    <option value="">Vyberte sklad</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="text-sm font-semibold text-gray-700 flex items-center gap-2 border-b border-gray-100 pb-2">
                  <Icons.Box className="w-4 h-4" />
                  Položky k převodu
                </div>
                {transferItems.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                    <Icons.Image className="mx-auto w-8 h-8 mb-2 opacity-20" />
                    <p>Zatím žádné položíky. Vyberte v seznamu vpravo.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {transferItems.map(ti => (
                      <div key={ti.itemId} className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200 group">
                        <div className="flex-1 font-medium text-gray-900">{ti.name}</div>
                        <div className="w-24">
                          <Input 
                            type="number" 
                            min="1" 
                            value={ti.qty} 
                            onChange={(e) => updateQty(ti.itemId, parseInt(e.target.value))} 
                            className="bg-white py-1"
                          />
                        </div>
                        <button 
                          onClick={() => removeTransferItem(ti.itemId)}
                          className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors"
                        >
                          <Icons.Trash className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-6">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Poznámka</label>
                <textarea
                  className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Důvod převodu..."
                />
              </div>

              <Button 
                variant="primary" 
                full 
                size="lg" 
                onClick={handleTransfer} 
                disabled={submitting || transferItems.length === 0}
                className="shadow-md"
              >
                {submitting ? "Provádím..." : "Potvrdit převod"}
              </Button>
            </CardContent>
          </Card>

          {/* Stock Matrix Table */}
          <Card className="shadow-sm overflow-hidden border-gray-200">
            <CardHeader className="bg-gray-50 border-b border-gray-200 py-3 px-6">
              <h3 className="font-semibold text-gray-800">Aktuální stav skladů</h3>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Položka</th>
                    {warehouses.map(w => (
                      <th key={w.id} className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">{w.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.slice(0, 10).map(i => (
                    <tr key={i.itemId} className="hover:bg-gray-50/50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{i.name}</td>
                      {warehouses.map(w => {
                        const stock = stocks[i.itemId]?.[w.id] ?? 0;
                        return (
                          <td key={w.id} className="px-6 py-3 text-right text-sm text-gray-600">
                            {stock}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {items.length > 10 && (
                    <tr>
                      <td colSpan={warehouses.length + 1} className="px-6 py-2 text-center text-xs text-gray-400 italic bg-gray-50/30">
                        Zobrazeno prvních 10 položek...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Item Selection Sidebar */}
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="p-4 border-b border-gray-100">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Icons.Search className="w-4 h-4" />
                </div>
                <Input
                  className="pl-10"
                  placeholder="Hledat položku..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto max-h-[calc(100vh-250px)]">
              {loading ? (
                <div className="p-8 text-center text-gray-400">Načítám...</div>
              ) : filteredItems.length === 0 ? (
                <div className="p-8 text-center text-gray-400">Nebylo nic nalezeno</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredItems.map(i => (
                    <button
                      key={i.itemId}
                      onClick={() => addItemToTransfer(i)}
                      className="w-full text-left p-4 hover:bg-indigo-50 transition-colors flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-sm font-semibold text-gray-900 group-hover:text-indigo-700">{i.name}</div>
                        <div className="text-[11px] text-gray-500">
                          {formatCategoryParentLabel(i.category.parent?.name, i.category.sub.name)}
                        </div>
                      </div>
                      <div className="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Icons.ChevronRight className="w-5 h-5" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
