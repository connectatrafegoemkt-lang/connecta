import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { lastMonths, monthLabel } from "@/shared/months";

export const num = (n: number) => n.toLocaleString("pt-BR");
export const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: cents >= 1_000_000 ? 0 : 2 });

/** Variação em relação ao mês anterior. */
export function Delta({ now, before, invert = false }: { now: number; before: number | undefined; invert?: boolean }) {
  if (before === undefined) return null;
  if (now === before) return <span className="inline-flex items-center gap-0.5 text-xs text-subtle"><Minus className="h-3 w-3" />igual</span>;
  const up = now > before;
  const good = invert ? !up : up;
  const pct = before === 0 ? null : Math.round(((now - before) / before) * 100);
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? "text-success" : "text-danger"}`} title={`Mês anterior: ${num(before)}`}>
      <Icon className="h-3 w-3" />
      {pct === null ? `+${num(now)}` : `${pct > 0 ? "+" : ""}${pct}%`}
    </span>
  );
}

/** Seletor de mês (formulário GET, funciona sem JavaScript). */
export function MonthPicker({ month, action }: { month: string; action: string }) {
  return (
    <form action={action} className="flex items-center gap-2 print:hidden">
      <select name="mes" defaultValue={month} className="input py-1.5 text-sm" aria-label="Mês do relatório">
        {lastMonths(13).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <button className="btn-secondary btn-sm">Ver</button>
    </form>
  );
}
