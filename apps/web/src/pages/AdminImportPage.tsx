import { useState } from "react";
import { apiBaseUrl, getCurrentUser, getToken } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Button from "../components/ui/Button";
import toast from "react-hot-toast";

export default function AdminImportPage() {
  const role = getCurrentUser()?.role ?? "";
  const [csv, setCsv] = useState(
    "name;parent_category;category;quantity;return_delay_days;unit;sku;active;notes;image_url\nSklenice voda;Inventář;Sklo;50;0;ks;SKLO-NEW;true;;\n"
  );
  const [out, setOut] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  if (role !== "admin") {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-slate-700">Import je dostupný pouze pro administrátora.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Import CSV</h1>
      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Soubor CSV</div>
          <div className="mt-1 text-sm text-slate-600">Oddělovač je středník <span className="font-semibold">;</span></div>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea className="h-56 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-slate-400" value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                setError(null);
                try {
                  const token = getToken();
                  const base = apiBaseUrl();
                  const res = await fetch(`${base}/admin/import/csv`, {
                    method: "POST",
                    headers: { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "text/plain" },
                    body: csv
                  });
                  const j = await res.json();
                  if (!res.ok) throw j;
                  setOut(j);
                  toast.success("Import hotový");
                } catch (e: any) {
                  const msg = e?.error?.message ?? "Import se nepovedl.";
                  setError(msg);
                  toast.error(msg);
                }
              }}
            >
              Importovat
            </Button>
          </div>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </CardContent>
      </Card>
      {out ? <pre className="rounded border bg-white p-4 text-xs overflow-auto">{JSON.stringify(out, null, 2)}</pre> : null}
    </div>
  );
}
