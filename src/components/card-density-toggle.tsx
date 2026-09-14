import { Columns3, Rows3 } from "lucide-react";

export function CardDensityToggle({ label, compact, onChange }: { label: string; compact: boolean; onChange: (compact: boolean) => void }) {
  return <div className="view-toggle" role="group" aria-label={label}>
    <button type="button" aria-pressed={!compact} onClick={() => onChange(false)} title="Comfortable cards"><Columns3 size={14} />Comfortable</button>
    <button type="button" aria-pressed={compact} onClick={() => onChange(true)} title="Compact cards"><Rows3 size={14} />Compact</button>
  </div>;
}
