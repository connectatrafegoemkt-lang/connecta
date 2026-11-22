/** Meses no formato "AAAA-MM", no fuso de Brasília. */

const TZ = "America/Sao_Paulo";
const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function currentMonth(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Valida "AAAA-MM" (de 2020 até o mês atual); senão, devolve o mês anterior ao atual. */
export function parseMonth(v: unknown, now = new Date()): string {
  const cur = currentMonth(now);
  if (typeof v === "string" && MES.test(v) && v >= "2020-01" && v <= cur) return v;
  return shiftMonth(cur, -1);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const s = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function lastMonths(n: number, now = new Date()): string[] {
  const cur = currentMonth(now);
  return Array.from({ length: n }, (_, i) => shiftMonth(cur, -i));
}
