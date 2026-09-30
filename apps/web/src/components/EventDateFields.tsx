import { multiDayLabel } from "../lib/eventDays";
import Input from "./ui/Input";

/// Datum akce od-do. Hodnoty jsou z inputů type="date" (YYYY-MM-DD). Nadřazený
/// formulář při změně předvyplní závoz a svoz. Vrací buňky do mřížky formuláře.
export default function EventDateFields(props: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const label = multiDayLabel(props.from, props.to);
  return (
    <>
      <label className="text-sm">
        Datum akce od
        <Input className="mt-1" type="date" value={props.from} onChange={(e) => props.onChange(e.target.value, props.to)} />
      </label>
      <label className="text-sm">
        Datum akce do <span className="text-slate-400">(nepovinné)</span>
        <Input
          className="mt-1"
          type="date"
          value={props.to}
          min={props.from || undefined}
          onChange={(e) => props.onChange(props.from, e.target.value)}
        />
      </label>
      {label ? <div className="text-xs text-slate-500 md:col-span-2">{label}</div> : null}
    </>
  );
}
