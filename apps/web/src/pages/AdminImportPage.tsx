import { useState } from "react";
import { getCurrentUser } from "../lib/api";

export default function AdminImportPage() {
  const role = getCurrentUser()?.role ?? "";
  const [csv, setCsv] = useState(
    "name;parent_category;category;quantity;return_delay_days;unit;sku;active;notes;image_url\nSklenice voda;Inventář;Sklo;50;0;ks;SKLO-NEW;true;;\n"
  );
  const [out, setOut] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Import CSV (admin)</h1>
      {role !== "admin" ? <div className="rounded border bg-white p-4 text-sm text-slate-700">Pouze admin.</div> : null}
      <div className="rounded border bg-white p-4 space-y-2">
        <div className="text-sm text-slate-600">POST `/admin/import/csv` očekává `text/plain` s `;` delimiter.</div>
        <textarea className="h-56 w-full rounded border p-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="flex gap-2">
          <button
            className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
            onClick={async () => {
              setError(null);
              try {
                const token = localStorage.getItem("token");
                const res = await fetch("/admin/import/csv", {
                  method: "POST",
                  headers: { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "text/plain" },
                  body: csv
                });
                const j = await res.json();
                if (!res.ok) throw j;
                setOut(j);
              } catch (e: any) {
                setError(e?.error?.message ?? "Import failed");
              }
            }}
          >
            Importovat
          </button>
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
      </div>
      {out ? <pre className="rounded border bg-white p-4 text-xs overflow-auto">{JSON.stringify(out, null, 2)}</pre> : null}
    </div>
  );
}
