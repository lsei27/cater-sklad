import Select from "./ui/Select";

export type EventFiltersData = {
    status?: string;
    month?: number;
    year?: number;
    onlyMine?: boolean;
};

type Props = {
    activeRole: string;
    filters: EventFiltersData;
    onChange: (filters: EventFiltersData) => void;
};

export default function EventFilters({ activeRole, filters, onChange }: Props) {
    const years = [new Date().getFullYear(), new Date().getFullYear() + 1];
    const months = [
        { value: 1, label: "Leden" },
        { value: 2, label: "Únor" },
        { value: 3, label: "Březen" },
        { value: 4, label: "Duben" },
        { value: 5, label: "Květen" },
        { value: 6, label: "Červen" },
        { value: 7, label: "Červenec" },
        { value: 8, label: "Srpen" },
        { value: 9, label: "Září" },
        { value: 10, label: "Říjen" },
        { value: 11, label: "Listopad" },
        { value: 12, label: "Prosinec" },
    ];

    const statuses = [
        { value: "DRAFT", label: "Koncept" },
        { value: "SENT_TO_WAREHOUSE", label: "Předáno skladu" },
        { value: "ISSUED", label: "Vydáno" },
        { value: "CLOSED", label: "Uzavřeno" },
        { value: "CANCELLED", label: "Zrušeno" },
    ];

    return (
        <div className="flex flex-wrap gap-2">
            <div className="w-full sm:w-48">
                <Select
                    value={filters.status || ""}
                    onChange={(e) => onChange({ ...filters, status: e.target.value || undefined })}
                >
                    <option value="">Všechny stavy</option>
                    {statuses.map((s) => (
                        <option key={s.value} value={s.value}>
                            {s.label}
                        </option>
                    ))}
                </Select>
            </div>

            <div className="w-full sm:w-40">
                <Select
                    value={filters.month || ""}
                    onChange={(e) => onChange({ ...filters, month: e.target.value ? Number(e.target.value) : undefined })}
                >
                    <option value="">Celý rok</option>
                    {months.map((m) => (
                        <option key={m.value} value={m.value}>
                            {m.label}
                        </option>
                    ))}
                </Select>
            </div>

            <div className="w-full sm:w-32">
                <Select
                    value={filters.year || ""}
                    onChange={(e) => onChange({ ...filters, year: e.target.value ? Number(e.target.value) : undefined })}
                >
                    {years.map((y) => (
                        <option key={y} value={y}>
                            {y}
                        </option>
                    ))}
                </Select>
            </div>

            {["admin", "event_manager"].includes(activeRole) && (
                <label className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                        type="checkbox"
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        checked={filters.onlyMine || false}
                        onChange={(e) => onChange({ ...filters, onlyMine: e.target.checked })}
                    />
                    <span className="text-sm font-medium text-slate-700 whitespace-nowrap">Moje akce</span>
                </label>
            )}
        </div>
    );
}
